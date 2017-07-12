///<reference path="../../../headers/common.d.ts" />

import angular from 'angular';
import _ from 'lodash';

class MixedDatasource {

  /** @ngInject */
  constructor(private $q, private datasourceSrv) {
  }

  query(options) {
    var sets = _.groupBy(options.targets, 'datasource');
    var promises = _.map(sets, targets => {
      var dsName = targets[0].datasource;
      if (dsName === '-- Mixed --') {
        return this.$q([]);
      }

      return this.datasourceSrv.get(dsName).then(function(ds) {
        var opt = angular.copy(options);
        opt.targets = targets;
        opt.series = null;
        if (options.series !== void 0 && options.series.length>0){
          for (var i = 0; i < options.series.length; i++){
            if (options.series[i].alias !== void 0 && options.series[i].alias === targets[0].alias){
              opt.series = options.series[i];
              break;
            }
          }
        }

        return ds.query(opt);
      });
    });

    return this.$q.all(promises).then(function(results) {
      return { data: _.flatten(_.map(results, 'data')) };
    });
  }
}

export {MixedDatasource, MixedDatasource as Datasource};
