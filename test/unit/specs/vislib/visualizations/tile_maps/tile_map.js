define(function (require) {
  var angular = require('angular');
  var _ = require('lodash');
  var $ = require('jquery');
  var L = require('leaflet');

  // Data
  var dataArray = [
    require('vislib_fixtures/mock_data/geohash/_geo_json'),
    require('vislib_fixtures/mock_data/geohash/_columns'),
    require('vislib_fixtures/mock_data/geohash/_rows')
  ];
  var names = ['geojson', 'columns', 'rows'];
  // TODO: Test the specific behavior of each these
  var mapTypes = ['Scaled Circle Markers', 'Shaded Circle Markers', 'Shaded Geohash Grid', 'Heatmap'];

  angular.module('TileMapFactory', ['kibana']);

  function bootstrapAndRender(data, type) {
    var vis;
    var visLibParams = {
      isDesaturated: true,
      type: 'tile_map',
      mapType: type
    };

    module('TileMapFactory');
    inject(function (Private) {
      vis = Private(require('vislib_fixtures/_vis_fixture'))(visLibParams);
      require('css!components/vislib/styles/main');
      vis.render(data);
    });

    return vis;
  }

  function destroyVis(vis) {
    $(vis.el).remove();
    vis = null;
  }

  describe('TileMap Tests', function () {
    describe('Rendering each types of tile map', function () {
      dataArray.forEach(function (data, i) {

        mapTypes.forEach(function (type, j) {

          describe('draw() ' + mapTypes[j] + ' with ' + names[i], function () {
            var vis;

            beforeEach(function () {
              vis = bootstrapAndRender(data, type);
            });

            afterEach(function () {
              destroyVis(vis);
            });

            it('should return a function', function () {
              vis.handler.charts.forEach(function (chart) {
                expect(chart.draw()).to.be.a(Function);
              });
            });

            it('should create .leaflet-container as a by product of map rendering', function () {
              expect($(vis.el).find('.leaflet-container').length).to.be.above(0);
            });
          });
        });
      });
    });

    describe('Leaflet controls', function () {
      var vis;
      var leafletContainer;

      beforeEach(function () {
        vis = bootstrapAndRender(dataArray[0], 'Scaled Circle Markers');
        leafletContainer = $(vis.el).find('.leaflet-container');
      });

      afterEach(function () {
        destroyVis(vis);
      });

      it('should attach the zoom controls', function () {
        expect(leafletContainer.find('.leaflet-control-zoom-in').length).to.be(1);
        expect(leafletContainer.find('.leaflet-control-zoom-out').length).to.be(1);
      });

      it('should attach the filter drawing button', function () {
        expect(leafletContainer.find('.leaflet-draw').length).to.be(1);
      });

      it('should attach the crop button', function () {
        expect(leafletContainer.find('.leaflet-control-fit').length).to.be(1);
      });

      it('should not attach the filter or crop buttons if no data is present', function () {
        var noData = {
          geoJson: {
            features: [],
            properties: {
              label: null,
              length: 30,
              min: 1,
              max: 608,
              precision: 1,
              allmin: 1,
              allmax: 608
            },
            hits: 20
          }
        };
        vis.render(noData);
        leafletContainer = $(vis.el).find('.leaflet-container');

        expect(leafletContainer.find('.leaflet-control-fit').length).to.be(0);
        expect(leafletContainer.find('.leaflet-draw').length).to.be(0);

      });

    });

  });
});
