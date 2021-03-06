package conditions

import (
	"math"

	"sort"

	"github.com/yinzhiqiang/grafana/pkg/components/null"
	"github.com/yinzhiqiang/grafana/pkg/tsdb"
)

type QueryReducer interface {
	Reduce(timeSeries *tsdb.TimeSeries) null.Float
}

type SimpleReducer struct {
	Type string
}

func (s *SimpleReducer) Reduce(series *tsdb.TimeSeries) null.Float {
	if len(series.Points) == 0 {
		return null.FloatFromPtr(nil)
	}

	value := float64(0)
	allNull := true

	switch s.Type {
	case "avg":
		validPointsCount := 0
		for _, point := range series.Points {
			if point[0].Valid {
				value += point[0].Float64
				validPointsCount += 1
				allNull = false
			}
		}
		if validPointsCount > 0 {
			value = value / float64(validPointsCount)
		}
	case "sum":
		for _, point := range series.Points {
			if point[0].Valid {
				value += point[0].Float64
				allNull = false
			}
		}
	case "min":
		value = math.MaxFloat64
		for _, point := range series.Points {
			if point[0].Valid {
				allNull = false
				if value > point[0].Float64 {
					value = point[0].Float64
				}
			}
		}
	case "max":
		value = -math.MaxFloat64
		for _, point := range series.Points {
			if point[0].Valid {
				allNull = false
				if value < point[0].Float64 {
					value = point[0].Float64
				}
			}
		}
	case "count":
		value = float64(len(series.Points))
		allNull = false
	case "last":
		points := series.Points
		for i := len(points) - 1; i >= 0; i-- {
			if points[i][0].Valid {
				value = points[i][0].Float64
				allNull = false
				break
			}
		}
	case "median":
		var values []float64
		for _, v := range series.Points {
			if v[0].Valid {
				allNull = false
				values = append(values, v[0].Float64)
			}
		}
		if len(values) >= 1 {
			sort.Float64s(values)
			length := len(values)
			if length%2 == 1 {
				value = values[(length-1)/2]
			} else {
				value = (values[(length/2)-1] + values[length/2]) / 2
			}
		}
	}

	if allNull {
		return null.FloatFromPtr(nil)
	}

	return null.FloatFrom(value)
}

func NewSimpleReducer(typ string) *SimpleReducer {
	return &SimpleReducer{Type: typ}
}
