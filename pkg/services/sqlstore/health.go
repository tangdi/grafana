package sqlstore

import (
	"github.com/yinzhiqiang/grafana/pkg/bus"
	m "github.com/yinzhiqiang/grafana/pkg/models"
)

func init() {
	bus.AddHandler("sql", GetDBHealthQuery)
}

func GetDBHealthQuery(query *m.GetDBHealthQuery) error {
	return x.Ping()
}
