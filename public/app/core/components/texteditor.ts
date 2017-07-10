///<reference path="../../headers/common.d.ts" />

import config from 'app/core/config';
import _ from 'lodash';
import $ from 'jquery';
import coreModule from 'app/core/core_module';

var template = `
<div class="graph-legend-popover">
  <p class="m-b-0">
     <label>
       Text:
       <input type="text" name="text" ng-model="text" required>
    </label>
   </p>
   <button ng-click="ctrl.textChanged();" class="btn"">
      Ok
    </button>
    <button ng-click="ctrl.close();"
      class="btn">
      Cancel
    </button>

</div>
`;

export class TextEditorCtrl {
  text: any;
  autoClose: boolean;

  /** @ngInject */
  constructor(private $scope, private $rootScope) {
    this.text = $rootScope.text;
    this.autoClose = $scope.autoClose;
  }

  close() {
    if (this.$scope.autoClose) {
      this.$scope.dismiss();
    }
  }

  textChanged() {
    this.$scope.textChanged(this.$scope.text);
    if (this.$scope.autoClose) {
      this.$scope.dismiss();
    }
  }
}

export function textEditor() {
  return {
    restrict: 'E',
    controller: TextEditorCtrl,
    bindToController: true,
    controllerAs: 'ctrl',
    template: template,
  };
}

coreModule.directive('gfTextEditor', textEditor);
