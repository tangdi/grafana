define([
  'angular',
  'jquery'
],
function (angular) {
  'use strict';

  angular
    .module('grafana.directives')
    .directive('panelDrilldown', function() {

      function getDrilldownContent(ctrl) {
        var linkSrv = ctrl.$injector.get('linkSrv');
        var html = '';
        if (ctrl.panel.links && ctrl.panel.links.length > 0) {
          for(var i=0; i<ctrl.panel.links.length; i++) {
            var link = ctrl.panel.links[i];
            var info = linkSrv.getPanelLinkAnchorInfo(link, ctrl.panel.scopedVars);
            html += '<i class="fa"><a href="' + info.href + '" target="' + info.target + '"> ' + info.title + '</a></i>';
          }
        }
        return html;
      }

      return {
        restrict: 'A',
        link: function($scope, elem) {
          var $panelContainer = elem.parents(".panel-container");
          var ctrl = $scope.ctrl;
          $panelContainer.find(".panel-drilldown").html(getDrilldownContent(ctrl));

        }
      };
    });
});
