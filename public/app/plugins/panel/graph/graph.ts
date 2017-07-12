///<reference path="../../../headers/common.d.ts" />

import 'jquery.flot';
import 'jquery.flot.selection';
import 'jquery.flot.time';
import 'jquery.flot.stack';
import 'jquery.flot.stackpercent';
import 'jquery.flot.fillbelow';
import 'jquery.flot.crosshair';
import 'jquery.flot.dashes';
import './jquery.flot.events';

import $ from 'jquery';
import _ from 'lodash';
import moment from 'moment';
import kbn from 'app/core/utils/kbn';
import {tickStep} from 'app/core/utils/ticks';
import {appEvents, coreModule} from 'app/core/core';
import GraphTooltip from './graph_tooltip';
import {ThresholdManager} from './threshold_manager';
import {EventManager} from 'app/features/annotations/all';
import {convertValuesToHistogram, getSeriesValues} from './histogram';

coreModule.directive('grafanaGraph', function($rootScope, timeSrv, popoverSrv) {
  return {
    restrict: 'A',
    template: '',
    link: function(scope, elem) {
      var ctrl = scope.ctrl;
      var dashboard = ctrl.dashboard;
      var panel = ctrl.panel;
      var annotations = [];
      var data;
      var plot;
      var sortedSeries;
      var legendSideLastValue = null;
      var rootScope = scope.$root;
      var panelWidth = 0;
      var eventManager = new EventManager(ctrl, elem, popoverSrv);
      var thresholdManager = new ThresholdManager(ctrl);
      var tooltip = new GraphTooltip(elem, dashboard, scope, function() {
        return sortedSeries;
      });
      var linkSrv = ctrl.$injector.get('linkSrv');
      var templateSrv = ctrl.$injector.get('templateSrv');
      var ticksMap;

      // panel events
      ctrl.events.on('panel-teardown', () => {
        thresholdManager = null;

        if (plot) {
          plot.destroy();
          plot = null;
        }
      });

      ctrl.events.on('render', function(renderData) {
        data = renderData || data;
        if (!data) {
          return;
        }

        for (var i = 0; i < data.length; i++){
          var series = data[i];
          //update extension line
          if (series.extensionLine !== void 0 && series.extensionLine){
            var minTimestampRange = ctrl.range.from.valueOf();
            var maxTimestampRange = ctrl.range.to.valueOf();
            //todo we should query the last nearby datapoint before the minTimestampRange

            var lastValue = 100;
            if(series.datapoints.length == 0){
              //not any data
              //series.datapoints = new Array(new Array(lastValue,ctrl.range.from.valueOf()));

            }else{
              var minTimestamp = series.datapoints[0][1];
              if (minTimestamp > ctrl.range.from.valueOf()){
                //series.datapoints.unshift(new Array(lastValue,ctrl.range.from.valueOf()));
              }
            }

            if(series.datapoints.length > 0) {
              var maxTimestamp = series.datapoints[series.datapoints.length - 1][1];
              if (maxTimestamp < ctrl.range.to.valueOf()) {
                series.datapoints.push(new Array(series.datapoints[series.datapoints.length - 1][0], ctrl.range.to.valueOf()));
              }
            }

          }
        }
        annotations = ctrl.annotations || [];
        render_panel();
      });

      // global events
      appEvents.on('graph-hover', function(evt) {
        // ignore other graph hover events if shared tooltip is disabled
        if (!dashboard.sharedTooltipModeEnabled()) {
          return;
        }

        // ignore if we are the emitter
        if (!plot || evt.panel.id === panel.id || ctrl.otherPanelInFullscreenMode()) {
          return;
        }

        tooltip.show(evt.pos);
      }, scope);

      appEvents.on('graph-hover-clear', function(event, info) {
        if (plot) {
          tooltip.clear(plot);
        }
      }, scope);

      function getLegendHeight(panelHeight) {
        if (!panel.legend.show || panel.legend.rightSide) {
          return 0;
        }

        if (panel.legend.alignAsTable) {
          var legendSeries = _.filter(data, function(series) {
            return series.hideFromLegend(panel.legend) === false;
          });
          var total = 23 + (21 * legendSeries.length);
          return Math.min(total, Math.floor(panelHeight/2));
        } else {
          return 26;
        }
      }

      function setElementHeight() {
        try {
          var height = ctrl.height - getLegendHeight(ctrl.height);
          elem.css('height', height + 'px');

          return true;
        } catch (e) { // IE throws errors sometimes
          console.log(e);
          return false;
        }
      }

      function shouldAbortRender() {
        if (!data) {
          return true;
        }

        if (!setElementHeight()) { return true; }

        if (panelWidth === 0) {
          return true;
        }
      }

      function drawHook(plot) {
        // Update legend values
        var yaxis = plot.getYAxes();
        for (var i = 0; i < data.length; i++) {
          var series = data[i];
          // //update extension line
          // if (series.extensionLine !== void 0 && series.extensionLine){
          //   var xaxis = plot.getXAxes();
          //
          //   if (series.data[series.data.length-1] !== void 0 && xaxis.length>0){
          //     var minTimestamp = series.data[0][0];
          //     if (minTimestamp > xaxis[0].min){
          //       //todo
          //       series.data.unshift(new Array(xaxis[0].min,100));
          //     }
          //
          //     var maxTimestamp = series.data[series.data.length-1][0];
          //     if (maxTimestamp <  xaxis[0].max){
          //       series.data.push(new Array(xaxis[0].max,series.data[series.data.length-1][1]));
          //     }
          //   }
          // }

          var axis = yaxis[series.yaxis - 1];
          var formater = kbn.valueFormats[panel.yaxes[series.yaxis - 1].format];
          var panelOptions = panel.yaxes[series.yaxis - 1];
          if (!series.ticksMap){
            series.ticksMap = parseTicks(panelOptions.ticks);
          }

          if (series.ticksMap && series.ticksMap.length > 0 && series.ticksMap[0].length === 2 ) {
            formater = function(value, decimals){
              if (value === null) {
                return "";
              }
              var length = this.ticksMap.length;
              for (var j = 0; j < length; j++) {
                if (this.ticksMap[j][0] === value.toString()){
                  return this.ticksMap[j][1];
                }
              }
              return value;
            };
          }

          // decimal override
          if (_.isNumber(panel.decimals)) {
            series.updateLegendValues(formater, panel.decimals, null);
          } else {
            // auto decimals
            // legend and tooltip gets one more decimal precision
            // than graph legend ticks
            var tickDecimals = (axis.tickDecimals || -1) + 1;
            series.updateLegendValues(formater, tickDecimals, axis.scaledDecimals + 2);
          }

          if (!rootScope.$$phase) { scope.$digest(); }
        }

        // add left axis labels
        if (panel.yaxes[0].label) {
          var yaxisLabel = $("<div class='axisLabel left-yaxis-label flot-temp-elem'></div>")
            .text(panel.yaxes[0].label);
          yaxisLabel.appendTo(elem);
        }

        // add right axis labels
        if (panel.yaxes[1].label) {
          var rightLabel = $("<div class='axisLabel right-yaxis-label flot-temp-elem'></div>")
            .text(panel.yaxes[1].label);
          rightLabel.appendTo(elem);
        }

        thresholdManager.draw(plot);
      }

      function parseTicks(ticksString){
        if (!ticksString||ticksString.trim().length<1){
          return null;
        }

        var ticksMap = new Array();

        var ticks = ticksString.trim().split(",");
        for (var j = 0; j < ticks.length; j++) {
          if (ticks[j] && ticks[j].length > 0) {
            var map = ticks[j].split("=");
            if (map.length === 1) {
              //ticks: [0, 1.2, 2.4]
              ticksMap.push(map);
            } else if (map.length === 2) {
              //ticks: [[0, "zero"], [1.2, "one mark"], [2.4, "two marks"]]
              ticksMap.push(new Array(map[0], map[1]));
            }

          }
        }
        return ticksMap;
      }

      function processOffsetHook(plot, gridMargin) {
        var left = panel.yaxes[0];
        var right = panel.yaxes[1];
        if (left.show && left.label) { gridMargin.left = 20; }
        if (right.show && right.label) { gridMargin.right = 20; }

        // apply y-axis min/max options
        var yaxis = plot.getYAxes();
        for (var i = 0; i < yaxis.length; i++) {
          var axis = yaxis[i];
          var panelOptions = panel.yaxes[i];
          axis.options.max = panelOptions.max;
          axis.options.min = panelOptions.min;

          ticksMap = parseTicks(panelOptions.ticks);
          if (ticksMap && ticksMap.length > 0) {
            axis.options.ticks = ticksMap;
          }

          if (panelOptions.color && panelOptions.color.trim().length > 0){
            var color = panelOptions.color.trim();
            axis.options.color = color;
            axis.options.font = {color: color};
          }
        }
      }

      // Series could have different timeSteps,
      // let's find the smallest one so that bars are correctly rendered.
      // In addition, only take series which are rendered as bars for this.
      function getMinTimeStepOfSeries(data) {
        var min = Number.MAX_VALUE;

        for (let i = 0; i < data.length; i++) {
          if (!data[i].stats.timeStep) {
            continue;
          }
          if (panel.bars) {
            if (data[i].bars && data[i].bars.show === false) {
              continue;
            }
          } else {
            if (typeof data[i].bars === 'undefined' || typeof data[i].bars.show === 'undefined' || !data[i].bars.show) {
              continue;
            }
          }

          if (data[i].stats.timeStep < min) {
            min = data[i].stats.timeStep;
          }
        }

        return min;
      }

      // Function for rendering panel
      function render_panel() {
        panelWidth =  elem.width();

        if (shouldAbortRender()) {
          return;
        }

        // give space to alert editing
        thresholdManager.prepare(elem, data);

        // un-check dashes if lines are unchecked
        panel.dashes = panel.lines ? panel.dashes : false;

        var stack = panel.stack ? true : null;

        // Populate element
        var options: any = {
          hooks: {
            draw: [drawHook],
            processOffset: [processOffsetHook],
          },
          legend: { show: false },
          series: {
            stackpercent: panel.stack ? panel.percentage : false,
            stack: panel.percentage ? null : stack,
            lines:  {
              show: panel.lines,
              zero: false,
              fill: translateFillOption(panel.fill),
              lineWidth: panel.dashes ? 0 : panel.linewidth,
              steps: panel.steppedLine
            },
            dashes: {
              show: panel.dashes,
              lineWidth: panel.linewidth,
              dashLength: [panel.dashLength, panel.spaceLength]
            },
            bars: {
              show: panel.bars,
              fill: 1,
              barWidth: 1,
              zero: false,
              lineWidth: 0
            },
            points: {
              show: panel.points,
              fill: 1,
              fillColor: false,
              radius: panel.points ? panel.pointradius : 2
            },
            shadowSize: 0
          },
          yaxes: [],
          xaxis: {},
          grid: {
            minBorderMargin: 0,
            markings: [],
            backgroundColor: null,
            borderWidth: 0,
            hoverable: true,
            clickable: true,
            color: '#c8c8c8',
            margin: { left: 0, right: 0 },
          },
          selection: {
            mode: "x",
            color: '#666'
          },
          crosshair: {
            mode: 'x'
          }
        };

        for (let i = 0; i < data.length; i++) {
          let series = data[i];
          series.data = series.getFlotPairs(series.nullPointMode || panel.nullPointMode);

          // if hidden remove points and disable stack
          if (ctrl.hiddenSeries[series.alias]) {
            series.data = [];
            series.stack = false;
          }
        }

        switch (panel.xaxis.mode) {
          case 'series': {
            options.series.bars.barWidth = 0.7;
            options.series.bars.align = 'center';

            for (let i = 0; i < data.length; i++) {
              let series = data[i];
              series.data = [[i + 1, series.stats[panel.xaxis.values[0]]]];
            }

            addXSeriesAxis(options);
            break;
          }
          case 'histogram': {
            let bucketSize: number;
            let values = getSeriesValues(data);

            if (data.length && values.length) {
              let histMin = _.min(_.map(data, s => s.stats.min));
              let histMax = _.max(_.map(data, s => s.stats.max));
              let ticks = panel.xaxis.buckets || panelWidth / 50;
              bucketSize = tickStep(histMin, histMax, ticks);
              let histogram = convertValuesToHistogram(values, bucketSize);

              data[0].data = histogram;
              data[0].alias = data[0].label = data[0].id = "count";
              data = [data[0]];

              options.series.bars.barWidth = bucketSize * 0.8;
            } else {
              bucketSize = 0;
            }

            addXHistogramAxis(options, bucketSize);
            break;
          }
          case 'table': {
            options.series.bars.barWidth = 0.7;
            options.series.bars.align = 'center';
            addXTableAxis(options);
            break;
          }
          default: {
            options.series.bars.barWidth = getMinTimeStepOfSeries(data) / 1.5;
            addTimeAxis(options);
            break;
          }
        }

        thresholdManager.addFlotOptions(options, panel);
        eventManager.addFlotEvents(annotations, options);
        configureAxisOptions(data, options);

        sortedSeries = _.sortBy(data, function(series) { return series.zindex; });

        function callPlot(incrementRenderCounter) {
          try {
            plot = $.plot(elem, sortedSeries, options);
            if (ctrl.renderError) {
              delete ctrl.error;
              delete ctrl.inspector;
            }
          } catch (e) {
            console.log('flotcharts error', e);
            ctrl.error = e.message || "Render Error";
            ctrl.renderError = true;
            ctrl.inspector = {error: e};
          }

          if (incrementRenderCounter) {
            ctrl.renderingCompleted();
          }
        }

        if (shouldDelayDraw(panel)) {
          // temp fix for legends on the side, need to render twice to get dimensions right
          callPlot(false);
          setTimeout(function() { callPlot(true); }, 50);
          legendSideLastValue = panel.legend.rightSide;
        } else {
          callPlot(true);
        }
      }

      function translateFillOption(fill) {
        return fill === 0 ? 0.001 : fill/10;
      }

      function shouldDelayDraw(panel) {
        if (panel.legend.rightSide) {
          return true;
        }
        if (legendSideLastValue !== null && panel.legend.rightSide !== legendSideLastValue) {
          return true;
        }
      }

      function addTimeAxis(options) {
        var ticks = panelWidth / 100;
        var min = _.isUndefined(ctrl.range.from) ? null : ctrl.range.from.valueOf();
        var max = _.isUndefined(ctrl.range.to) ? null : ctrl.range.to.valueOf();

        options.xaxis = {
          timezone: dashboard.getTimezone(),
          show: panel.xaxis.show,
          mode: "time",
          min: min,
          max: max,
          label: "Datetime",
          ticks: ticks,
          timeformat: time_format(ticks, min, max),
        };
      }

      function addXSeriesAxis(options) {
        var ticks = _.map(data, function(series, index) {
          return [index + 1, series.alias];
        });

        options.xaxis = {
          timezone: dashboard.getTimezone(),
          show: panel.xaxis.show,
          mode: null,
          min: 0,
          max: ticks.length + 1,
          label: "Datetime",
          ticks: ticks
        };
      }

      function addXHistogramAxis(options, bucketSize) {
        let ticks, min, max;

        if (data.length && bucketSize) {
          ticks = _.map(data[0].data, point => point[0]);

          // Expand ticks for pretty view
          min = Math.max(0, _.min(ticks) - bucketSize);
          max = _.max(ticks) + bucketSize;

          ticks = [];
          for (let i = min; i <= max; i += bucketSize) {
            ticks.push(i);
          }
        } else {
          // Set defaults if no data
          ticks = panelWidth / 100;
          min = 0;
          max = 1;
        }

        options.xaxis = {
          timezone: dashboard.getTimezone(),
          show: panel.xaxis.show,
          mode: null,
          min: min,
          max: max,
          label: "Histogram",
          ticks: ticks
        };
      }

      function addXTableAxis(options) {
        var ticks = _.map(data, function(series, seriesIndex) {
          return _.map(series.datapoints, function(point, pointIndex) {
            var tickIndex = seriesIndex * series.datapoints.length + pointIndex;
            return [tickIndex + 1, point[1]];
          });
        });
        ticks = _.flatten(ticks, true);

        options.xaxis = {
          timezone: dashboard.getTimezone(),
          show: panel.xaxis.show,
          mode: null,
          min: 0,
          max: ticks.length + 1,
          label: "Datetime",
          ticks: ticks
        };
      }

      function configureAxisOptions(data, options) {
        var defaults = {
          position: 'left',
          show: panel.yaxes[0].show,
          index: 1,
          logBase: panel.yaxes[0].logBase || 1,
          min: panel.yaxes[0].min ? _.toNumber(panel.yaxes[0].min) : null,
          max: panel.yaxes[0].max ? _.toNumber(panel.yaxes[0].max) : null,
        };

        options.yaxes.push(defaults);

        if (_.find(data, {yaxis: 2})) {
          var secondY = _.clone(defaults);
          secondY.index = 2;
          secondY.show = panel.yaxes[1].show;
          secondY.logBase = panel.yaxes[1].logBase || 1;
          secondY.position = 'right';
          secondY.min = panel.yaxes[1].min ? _.toNumber(panel.yaxes[1].min) : null;
          secondY.max = panel.yaxes[1].max ? _.toNumber(panel.yaxes[1].max) : null;
          options.yaxes.push(secondY);

          applyLogScale(options.yaxes[1], data);
          configureAxisMode(options.yaxes[1], panel.percentage && panel.stack ? "percent" : panel.yaxes[1].format);
        }
        applyLogScale(options.yaxes[0], data);
        configureAxisMode(options.yaxes[0], panel.percentage && panel.stack ? "percent" : panel.yaxes[0].format);
      }

      function applyLogScale(axis, data) {
        if (axis.logBase === 1) {
          return;
        }
        if (axis.min < Number.MIN_VALUE) {
          axis.min = null;
        }
        if (axis.max < Number.MIN_VALUE) {
          axis.max = null;
        }

        var series, i;
        var max = axis.max, min = axis.min;

        for (i = 0; i < data.length; i++) {
          series = data[i];
          if (series.yaxis === axis.index) {
            if (!max || max < series.stats.max) {
              max = series.stats.max;
            }
            if (!min || min > series.stats.logmin) {
              min = series.stats.logmin;
            }
          }
        }

        axis.transform = function(v) { return (v < Number.MIN_VALUE) ? null : Math.log(v) / Math.log(axis.logBase); };
        axis.inverseTransform  = function (v) { return Math.pow(axis.logBase,v); };

        if (!max && !min) {
          max = axis.inverseTransform(+2);
          min = axis.inverseTransform(-2);
        } else if (!max) {
          max = min*axis.inverseTransform(+4);
        } else if (!min) {
          min = max*axis.inverseTransform(-4);
        }

        if (axis.min) {
          min = axis.inverseTransform(Math.ceil(axis.transform(axis.min)));
        } else {
          min = axis.min = axis.inverseTransform(Math.floor(axis.transform(min)));
        }
        if (axis.max) {
          max = axis.inverseTransform(Math.floor(axis.transform(axis.max)));
        } else {
          max = axis.max = axis.inverseTransform(Math.ceil(axis.transform(max)));
        }

        if (!min || min < Number.MIN_VALUE || !max || max < Number.MIN_VALUE) {
          return;
        }

        axis.ticks = [];
        var nextTick;
        for (nextTick = min; nextTick <= max; nextTick *= axis.logBase) {
          axis.ticks.push(nextTick);
        }
        axis.tickDecimals = decimalPlaces(min);
      }

      function decimalPlaces(num) {
        if (!num) { return 0; }

        return (num.toString().split('.')[1] || []).length;
      }

      function configureAxisMode(axis, format) {
        axis.tickFormatter = function(val, axis) {
          return kbn.valueFormats[format](val, axis.tickDecimals, axis.scaledDecimals);
        };
      }

      function time_format(ticks, min, max) {
        if (min && max && ticks) {
          var range = max - min;
          var secPerTick = (range/ticks) / 1000;
          var oneDay = 86400000;
          var oneYear = 31536000000;

          if (secPerTick <= 45) {
            return "%H:%M:%S";
          }
          if (secPerTick <= 7200 || range <= oneDay) {
            return "%H:%M";
          }
          if (secPerTick <= 80000) {
            return "%m/%d %H:%M";
          }
          if (secPerTick <= 2419200 || range <= oneYear) {
            return "%m/%d";
          }
          return "%Y-%m";
        }

        return "%H:%M";
      }

      elem.bind("plotselected", function (event, ranges) {
        if (ranges.ctrlKey || ranges.metaKey)  {
          // scope.$apply(() => {
          //   eventManager.updateTime(ranges.xaxis);
          // });
        } else {
          scope.$apply(function() {
            timeSrv.setTime({
              from  : moment.utc(ranges.xaxis.from),
              to    : moment.utc(ranges.xaxis.to),
            });
          });
        }
      });

      var self = this;
      elem.bind("plotclick", function (event, pos, item) {
        if (pos.ctrlKey || pos.metaKey || eventManager.event)  {
          // Skip if range selected (added in "plotselected" event handler)
          let isRangeSelection = pos.x !== pos.x1;
          if (!isRangeSelection) {
            // scope.$apply(() => {
            //   eventManager.updateTime({from: pos.x, to: null});
            // });
          }
        }

        var panel = ctrl.panel;
        if (panel.drilldowns !== void 0){
          for (var y = 0; y < panel.drilldowns.length; y++) {
          var drilldown = panel.drilldowns[y];
          var alias = item.series.alias;
          var regexp = new RegExp(drilldown.alias);

          if (regexp.test(alias)) {
            //add panel.scopedVars for repeat var
            var scopedVars = panel.scopedVars? panel.scopedVars: {};

            scopedVars["alias"] = {"value": alias};

            if (drilldown.separator && drilldown.separator.trim().length>0){
              var values = alias.split(drilldown.separator);
              for (var i = 0; i < values.length; i++ ){
                scopedVars["alias"+i] = {"value": values[i]};
              }
            }

            var fromTimestamp =  moment(new Date(item.datapoint[0]));
            var toTimestamp = moment(new Date(item.datapoint[0] + item.series.stats.timeStep));
            //TODO
            var format = drilldown.format;

            var fromStr;
            var toStr;

            if (format){
              fromStr = fromTimestamp.format(format);
              toStr = toTimestamp.utc().format(format);
            } else {
              fromStr = fromTimestamp.toISOString();
              toStr = toTimestamp.toISOString();
            }

            scopedVars['from'] =  {"value": fromStr};
            scopedVars['to'] =  {"value": toStr};

            //var link = self.getPanelLinkAnchorInfo(drilldown,scopedVars);
            var info = {};
            if (drilldown.type === 'absolute') {
              info["target"] = drilldown.targetBlank ? '_blank' : '_self';
              info["href"] = templateSrv.replace(drilldown.url || '', scopedVars);
              info["title"] = templateSrv.replace(drilldown.title || '', scopedVars);
            } else if (drilldown.dashUri) {
              info["href"] = 'dashboard/' + drilldown.dashUri + '?';
              info["title"] = templateSrv.replace(drilldown.title || '', scopedVars);
              info["target"] = drilldown.targetBlank ? '_blank' : '';
            } else {
              info["title"] = templateSrv.replace(drilldown.title || '', scopedVars);
              var slug = kbn.slugifyForUrl(drilldown.dashboard || '');
              info["href"] = 'dashboard/db/' + slug + '?';
            }

            var params = {};

            if (drilldown.keepTime) {
              var range = timeSrv.timeRangeForUrl();
              params['from'] = range.from;
              params['to'] = range.to;
            }

            if (drilldown.includeVars !== void 0) {
                var panelVars = drilldown.includeVars.split(",");
                _.each(templateSrv.variables, function(variable) {
                if (panelVars.indexOf(variable.name)>=0) {
                    params['var-' + variable.name] = variable.getValueForUrl();
                }
              });
            }

            info["href"] = linkSrv.addParamsToUrl(info["href"], params);

            if (drilldown.params) {
              info["href"] = linkSrv.appendToQueryString(info["href"], templateSrv.replace(drilldown.params, scopedVars));
            }


            if (drilldown.targetBlank) {
                window.open(info["href"], '_blank');
               } else {
                window.open(info["href"], '_self');
             }
          }
        }
        }
      });

      scope.$on('$destroy', function() {
        tooltip.destroy();
        elem.off();
        elem.remove();
      });
    }
  };
});
