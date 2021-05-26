/**
 * @file
 *
 * Defines the {@link WaveformOrdinateAxis} class.
 *
 * @module waveform-axis
 */

define([
  './utils',
  'konva'
], function(Utils, Konva) {
  'use strict';

  /**
   * Creates the waveform axis shapes and adds them to the given view layer.
   *
   * @class
   * @alias WaveformOrdinateAxis
   *
   * @param {WaveformOverview|WaveformZoomView} view
   * @param {Object} options
   * @param {String} options.axisGridlineColor
   * @param {String} options.axisLabelColor
   */

  function WaveformOrdinateAxis(view, options) {
    var self = this;

    self._axisGridlineColor = options.axisGridlineColor;
    self._axisLabelColor    = options.axisLabelColor;

    self._axisShape = new Konva.Shape({
      sceneFunc: function(context) {
        self.drawAxis(context, view);
      }
    });
  }

  WaveformOrdinateAxis.prototype.addToLayer = function(layer) {
    layer.add(this._axisShape);
  };

  /**
   * Returns number of seconds for each x-axis marker, appropriate for the
   * current zoom level, ensuring that markers are not too close together
   * and that markers are placed at intuitive time intervals (i.e., every 1,
   * 2, 5, 10, 20, 30 seconds, then every 1, 2, 5, 10, 20, 30 minutes, then
   * every 1, 2, 5, 10, 20, 30 hours).
   *
   * @param {WaveformOverview|WaveformZoomView} view
   * @returns {Number}
   */

  WaveformOrdinateAxis.prototype.getAxisLabelScale = function(view) {
    var baseSecs   = 1; // seconds
    var steps      = [1, 2, 5, 10, 20, 30];
    var minSpacing = 60;
    var index      = 0;

    var secs;

    for (;;) {
      secs = baseSecs * steps[index];
      var pixels = view.timeToPixels(secs);

      if (pixels < minSpacing) {
        if (++index === steps.length) {
          baseSecs *= 60; // seconds -> minutes -> hours
          index = 0;
        }
      }
      else {
        break;
      }
    }

    return secs;
  };

  /**
   * Draws the marker
   * @param {any} context
   * @param {any} i
   * @param {any} y
   * @param {any} width
   */

  WaveformOrdinateAxis.prototype._drawMarker = function(context, i, y, width, height) {
    var markerHeightBig = 10;
    var markerHeightSmall = 5;

    var isBigTick = (i % 5 === 0);

    // Define marker height
    var markerHeight = isBigTick ? markerHeightBig : markerHeightSmall;

    // Draw marker
    // TODO in the waveform axis the x is displaced by 0.5, not sure why though
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(0 + markerHeight, y);
    context.moveTo(width, y);
    context.lineTo(width - markerHeight, y);
    context.stroke();

    // if (!isBigTick) {
    //  return;
    // }

    // Big tick: add the label
    // var label = (1 - i * 0.1).toString();
    var label;

    if (i < 12) {
      label = -(i * 5).toString();
    }

    if (i >= 12) {
      label = -60 + (i - 12) * 5;
    }
    // Make sure that the label is always visible: by default the text is vertically
    // centered except for the two extreme points where it is placed at theù
    // top / bottom
    var textBaseline = 'middle';

    if (i === 0) {
      textBaseline = 'top';
    }
    if (i === 20) {
      textBaseline = 'bottom';
    }

    context.setAttr('textBaseline', textBaseline);

    context.fillText(label, markerHeight + 1, y);
  };

  /**
   * Draws the time axis and labels onto a view.
   * There are two possible scales:
   * 1) db --> range [0, -60] db
   * 2) linear --> range [1, -1]
   *
   * @param {Konva.Context} context The context to draw on.
   * @param {WaveformOverview|WaveformZoomView} view
   */
  WaveformOrdinateAxis.prototype.drawAxis = function(context, view) {
    context.setAttr('strokeStyle', this._axisGridlineColor);
    context.setAttr('lineWidth', 1);

    // Set text style
    context.setAttr('font', '11px sans-serif');
    context.setAttr('fillStyle', this._axisLabelColor);
    context.setAttr('textAlign', 'left');
    var markerHeight = 10;

    var width  = view.getWidth();
    var height = view.getHeight();
    // TODO add some vertical margin to avoid drawing above / below the x axis
    // TODO check out how difficult it would be to avoid drawing above the graph
    // Apply some margin to avoid drawing abose/below the x axis
    // margin = 2 * markerHeight (10) + xLabel (11px) + 2 * yLabel / 2 (5.5) * buffer (3px) = 45;
    var margin = 0;
    var axisHeight = height - margin;
    var nIntervals = this._getNIntervals(view.getIsDbScale());

    var dy = axisHeight / nIntervals;
    var y;

    for (var i = 0; i < nIntervals + 1; i++) {
      y = margin / 2 + i * dy;
      // Draw marker
      // In the x axis the marker is offset from the x position by 0.5, not sure
      // why though...
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(0 + markerHeight, y);
      context.moveTo(width, y);
      context.lineTo(width - markerHeight, y);
      context.stroke();

      // Add label
      var label = this._getMarkerLabel(i, !view.getIsDbScale());

      // Make sure the first and last labels are visible by not centering them at the
      // label center
      var textBaseline = 'middle';

      if (i === 0) {
        textBaseline = 'top';
      }

      if (i === nIntervals) {
        textBaseline = 'bottom';
      }

      context.setAttr('textBaseline', textBaseline);

      context.fillText(label, markerHeight + 1, y);
      // this._drawMarker(context, i, y, width, height);
    }
  };

  /**
   * db scale --> 24 (resolution of 5db)
   * linear scale --> 20 (resolution of 0.1)
   *
   */
  WaveformOrdinateAxis.prototype._getNIntervals = function(dbScale) {
    if (dbScale) {
      return 24;
    }

    return 20;
  };

  WaveformOrdinateAxis.prototype._getMarkerLabel = function(i, linearScale) {
    if (linearScale) {
      return (1 - 0.1 * i).toFixed(1).toString();
    }

    // Dealing with db scale
    if (i < 12) {
      return  -(5 * i).toString();
    }

    if (i >= 12) {
      return (-60 + (i - 12) * 5).toString();
    }
  };

  return WaveformOrdinateAxis;
});
