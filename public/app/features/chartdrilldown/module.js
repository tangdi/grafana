define([
  'angular',
  'lodash'
],
function (angular, _) {
  'use strict';

  angular
    .module('grafana.directives')
    .directive('chartDrilldownEditor', function() {
      return {
        scope: {
          panel: "="
        },
        restrict: 'E',
        controller: 'ChartDrilldownEditorCtrl',
        templateUrl: 'public/app/features/chartdrilldown/module.html',
        link: function() {
        }
      };
    }).controller('ChartDrilldownEditorCtrl', function($scope, backendSrv) {

      $scope.panel.drilldowns = $scope.panel.drilldowns || [];

      $scope.addLink = function() {
        $scope.panel.drilldowns.push({
          alias: '/.*/',
          type: 'dashboard',
        });
      };

      $scope.searchDashboards = function(queryStr, callback) {
        backendSrv.search({query: queryStr}).then(function(hits) {
          var dashboards = _.map(hits, function(dash) {
            return dash.title;
          });

          callback(dashboards);
        });
      };

      $scope.dashboardChanged = function(link) {
        backendSrv.search({query: link.dashboard}).then(function(hits) {
          var dashboard = _.find(hits, {title: link.dashboard});
          if (dashboard) {
            link.dashUri = dashboard.uri;
            link.title = dashboard.title;
          }
        });
      };

      $scope.deleteLink = function(link) {
        $scope.panel.drilldowns = _.without($scope.panel.drilldowns, link);
      };
    });
});
