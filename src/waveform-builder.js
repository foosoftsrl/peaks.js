/**
 * @file
 *
 * Defines the {@link WaveformBuilder} class.
 *
 * @module waveform-builder
 */

define([
  'waveform-data',
  './utils'
], function(
    WaveformData,
    Utils) {
  'use strict';

  var isXhr2 = ('withCredentials' in new XMLHttpRequest());

  /**
   * Creates and returns a WaveformData object, either by requesting the
   * waveform data from the server, or by creating the waveform data using the
   * Web Audio API.
   *
   * @class
   * @alias WaveformBuilder
   *
   * @param {Peaks} peaks
   */

  function WaveformBuilder(peaks) {
    this._peaks = peaks;
  }

  /**
   * Options for requesting remote waveform data.
   *
   * @typedef {Object} RemoteWaveformDataOptions
   * @global
   * @property {String=} arraybuffer
   * @property {String=} json
   */

  /**
   * Options for supplying local waveform data.
   *
   * @typedef {Object} LocalWaveformDataOptions
   * @global
   * @property {ArrayBuffer=} arraybuffer
   * @property {Object=} json
   */

  /**
   * Options for the Web Audio waveform builder.
   *
   * @typedef {Object} WaveformBuilderWebAudioOptions
   * @global
   * @property {AudioContext} audioContext
   * @property {AudioBuffer=} audioBuffer
   * @property {Number=} scale
   * @property {Boolean=} multiChannel
   */

  /**
   * Options for [WaveformBuilder.init]{@link WaveformBuilder#init}.
   *
   * @typedef {Object} WaveformBuilderInitOptions
   * @global
   * @property {RemoteWaveformDataOptions=} dataUri
   * @property {LocalWaveformDataOptions=} waveformData
   * @property {WaveformBuilderWebAudioOptions=} webAudio
   * @property {Boolean=} withCredentials
   * @property {Array<Number>=} zoomLevels
   */

  /**
   * Callback for receiving the waveform data.
   *
   * @callback WaveformBuilderInitCallback
   * @global
   * @param {Error} error
   * @param {WaveformData} waveformData
   */

  /**
   * Loads or creates the waveform data.
   *
   * @private
   * @param {WaveformBuilderInitOptions} options
   * @param {WaveformBuilderInitCallback} callback
   */

  WaveformBuilder.prototype.init = function(options, callback) {
    if ((options.dataUri && (options.webAudio || options.audioContext)) ||
        (options.waveformData && (options.webAudio || options.audioContext)) ||
        (options.dataUri && options.waveformData)) {
      // eslint-disable-next-line max-len
      callback(new TypeError('Peaks.init(): You may only pass one source (webAudio, dataUri, or waveformData) to render waveform data.'));
      return;
    }

    if (options.audioContext) {
      // eslint-disable-next-line max-len
      this._peaks.options.deprecationLogger('Peaks.init(): The audioContext option is deprecated, please pass a webAudio object instead');

      options.webAudio = {
        audioContext: options.audioContext
      };
    }

    if (options.dataUri) {
      return this._getRemoteWaveformData(options, callback);
    }
    else if (options.waveformData) {
      return this._buildWaveformFromLocalData(options, callback);
    }
    else if (options.webAudio) {
      if (options.webAudio.audioBuffer) {
        return this._buildWaveformDataFromAudioBuffer(options, callback);
      }
      else {
        return this._buildWaveformDataUsingWebAudio(options, callback);
      }
    }
    else {
      // eslint-disable-next-line max-len
      callback(new Error('Peaks.init(): You must pass an audioContext, or dataUri, or waveformData to render waveform data'));
    }
  };

  /* eslint-disable max-len */

  /**
   * Fetches waveform data, based on the given options.
   *
   * @private
   * @param {Object} options
   * @param {String|Object} options.dataUri
   * @param {String} options.dataUri.arraybuffer Waveform data URL
   *   (binary format)
   * @param {String} options.dataUri.json Waveform data URL (JSON format)
   * @param {String} options.defaultUriFormat Either 'arraybuffer' (for binary
   *   data) or 'json'
   * @param {WaveformBuilderInitCallback} callback
   *
   * @see Refer to the <a href="https://github.com/bbc/audiowaveform/blob/master/doc/DataFormat.md">data format documentation</a>
   *   for details of the binary and JSON waveform data formats.
   */

  /* eslint-enable max-len */

  /**
   * A sort of "virtual" channel in which a possibly very long (ideally) array of samples
   * is 0 expect on a small range [dataOffset,dataOffset + data.length)
   */
  class VirtualChannel {
    /**
     * 
     * @param {*} samples_per_pixel how many samples in a pixel
     * @param {*} detailUriProvider an object which provides a URL for getting peak data Signaure: (fromSecs,toSecs)->String
     * @param {*} refreshCallback a callback called when data has been async loaded
     */
    constructor(originalWaveform, samples_per_pixel, detailUriProvider, refreshCallback) {
      this._originalWaveform = originalWaveform;
      this._samples_per_pixel = samples_per_pixel;
      this.data = []; // 
      this.dataOffset = 0; // offset of available data the "virtual" array 
      this._detailUriProvider = detailUriProvider;
      this._refreshCallback = refreshCallback;
    }
    /**
     * Get the min value of the waveform at a given pixel index
     * @param {*} index index of the pixel (audio sample = index * samples_per_pixel)
     */
    min_sample(index) {
      this.ensureIndexAvailable(index);
      return this.data[(index - this.dataOffset) * 2];
    }

    /**
     * Get the max value of the waveform at a given pixel index
     * @param {*} index index of the pixel (audio sample = index * samples_per_pixel)
     */
    max_sample(index) {
      this.ensureIndexAvailable(index);
      return this.data[(index - this.dataOffset) * 2 + 1];
    }

    /**
     * Tell if the pixel at the given index is available
     * @param {*} index index of the pixel (audio sample = index * samples_per_pixel)
     */
    in_range(index) {
      return index >= this.dataOffset && index < this.dataOffset + this.data.length / 2;
    }

    /**
     * Ensure that the pixel at the given index is available, possibly asynchronously loading more data
     * @param {*} index index of the pixel (audio sample = index * samples_per_pixel)
     */
    ensureIndexAvailable(index) {
      if(index >= this.dataOffset && index <= this.dataOffset + this.data.length / 2)
        return;
      // The reasoning here is that, at this instant, how large is the player window:
      // so assume that is not longer than n pixel and take double the witdh because the
      // time marker could be at the beginning or end of the window
      const maxWindowSize = 2000;
      var from = index - maxWindowSize;
      var to = index + maxWindowSize;
      var newData = new Array((to - from) * 2); // size of array is 2 (min,max) * number of points

      // Copy available data from what was previously loaded, or from the original waveform
      var useUpsampledOriginalData = true;
      var orgChannel = this._originalWaveform.channel(0);
      for(var i = from; i < to; i++) {
        if(this.in_range(i)) {
          newData[(i - from) * 2] = this.data[(i - this.dataOffset) * 2];
          newData[(i - from) * 2 + 1] = this.data[(i - this.dataOffset) * 2 + 1];
        } else if(useUpsampledOriginalData) {
          var sampleIdxInOriginalWave = Math.round(.5 + i * this._samples_per_pixel / this._originalWaveform.scale);
          if(sampleIdxInOriginalWave >= 0 && sampleIdxInOriginalWave < this._originalWaveform.length) {
            newData[(i - from) * 2] = orgChannel.min_sample(sampleIdxInOriginalWave);
            newData[(i - from) * 2 + 1] = orgChannel.max_sample(sampleIdxInOriginalWave);
          }
        }
      }
      this.data = newData;
      this.dataOffset = from;
      var url = this._detailUriProvider(from * this._samples_per_pixel / 48000, to * this._samples_per_pixel / 48000);
      if(this.xhr)
        this.xhr.abort();
      var xhr = this.xhr = new XMLHttpRequest();
      xhr.responseType = "json";
      xhr.open('GET', url, true);
      xhr.onload = event => {
        if (xhr.readyState !== 4) {
          return;
        }
  
        if (xhr.status !== 200) {
          console.log('Unable to fetch remote data. HTTP status ' + xhr.status)
          return;
        }
  
        var waveformData = WaveformData.create(event.target.response);
        if (waveformData.channels !== 1) {
          console.log('Peaks.init(): Only mono or stereo waveforms are currently supported');
          return;
        }
        var resampled = waveformData.resample({
          "scale": this._samples_per_pixel
        });
        var channel = resampled.channel(0);
        var numSamplesToCopy = Math.min(to - from, waveformData.length);
        for(var dataIdx = 0; dataIdx < numSamplesToCopy; dataIdx++) {
          this.data[dataIdx * 2] = channel.min_sample(dataIdx);
          this.data[dataIdx * 2 + 1] = channel.max_sample(dataIdx);
        }
        if(this._refreshCallback) {
          this._refreshCallback();
        }
      }
      this.xhr.send();
    }
  }

  /**
   * A sort of "virtual" WaveForm in which a possibly very long (ideally) array of samples is 0 expect on a small range
   * Which is loaded on demand via http
   */
  class DynamicLoadWaveForm {
    /**
     * 
     * @param {*} waveformData reference to the original data, as shown in the overview
     * @param {*} length virtual length in pixels of the peaks data
     * @param {*} detailUriProvider an object which provides a URL for getting peak data Signaure: (fromSecs,toSecs)->String
     * @param {*} refreshCallback a callback called when data has been async loaded
     */
    constructor(waveformData, length, detailUriProvider, refreshCallback) {
      // duration = length * samples_per_pixel / sample_rate;
      if(waveformData.channels != 1) {
        throw "No support for multiple channels";
      }
      this._waveformData = waveformData;
      this._length = length;
      this._samples_per_pixel = waveformData.scale * waveformData.length / length;
      this._channel = new VirtualChannel(waveformData, this._samples_per_pixel, detailUriProvider, refreshCallback);
      this._refreshCallback = refreshCallback;
    }
    
    /**
     * Returns the number of samples per second.
     *
     * @return {Integer} Number of samples per second.
     */

    get sample_rate() {
      return this._waveformData.sample_rate;
    }

    /**
     * Returns the length of the waveform data (number of data points).
     *
     * @return {Integer} Length of the waveform data.
     */
    get length() {
      return this._length;
    }
    /**
    * Returns the scale (number of samples per pixel).
    *
    * @return {Integer} Number of samples per pixel.
    */
    get scale() {
      return this._samples_per_pixel;
    }

    /**
     * Returns the number of channels
     *
     * @return {Integer} Number of channels
     */
    get channels() {
      return this._waveformData.channels;
    }

    /**
     * Return peaks data for the channel at the given index
     * @param {*} index 
     */
    channel(index) {
      if(index != 0)
        throw "Invalid channel";
      return this._channel;
    }

    /**
     * Implementation of Waveform resample method. 
     * 
     * No need to implement it, just throw
     * 
     * @param {*} args 
     */
    resample(args) {
      throw "A resampled waveform can't be resampled";
    }
  }

  /**
   * A Waveform which extends scaling capabilities, using higher resolution remotely provided data when requested
   * resolution is too high
   */
  class DynamicResampleWaveform {
    constructor(response, detailUriProvider) {
      this.waveformData = WaveformData.create(response);
      this._detailUriProvider = detailUriProvider;
    }

    get dynamic() {
      return true;
    }
    /**
     * Returns the number of samples per second.
     *
     * @return {Integer} Number of samples per second.
     */

    get sample_rate() {
      return this.waveformData.sample_rate;
    }

    /**
     * Returns the length of the waveform data (number of data points).
     *
     * @return {Integer} Length of the waveform data.
     */
    get length() {
      return this.waveformData.length;
    }
    /**
    * Returns the scale (number of samples per pixel).
    *
    * @return {Integer} Number of samples per pixel.
    */
    get scale() {
      return this.waveformData.scale;
    }

    /**
     * Returns the number of channels
     *
     * @return {Integer} Number of channels
     */
    get channels() {
      return this.waveformData.channels;
    }

    /**
     * Return peaks data for the channel at the given index
     * @param {*} index 
     */
    channel(index) {
      return this.waveformData.channel(index);
    }

    /**
     * Implementation of Waveform resample method. 
     * 
     * Use standard resampling (downsampling) when requested scale / samples_per_pixel is higher than
     * original waveform, and DynamicLoadWaveform otherwise
     * 
     * @param {*} args An object containing either a "scale" or "width" attribute
     * @param {*} callback A callback which is called when the min/max sample data changes
     */
    resample(args, callback) {
      var length;
      if(args.scale) {
        length = this.waveformData.duration * this.waveformData.sample_rate / args.scale
      } else {
        length = args.width;
      }
      // If original data subsampling is possible, use standard resample, 
      // otherwise create a DynamicLoadWaveForm instance, which fetches higher resolution data
      if(length > this.waveformData.length) {
        return new DynamicLoadWaveForm(this, length, this._detailUriProvider, callback);
      } else {
        return this.waveformData.resample(args);
      }
    }
  }

  WaveformBuilder.prototype._getRemoteWaveformData = function(options, callback) {
    var self = this;
    var dataUri = null;
    var requestType = null;
    var url;

    if (Utils.isObject(options.dataUri)) {
      dataUri = options.dataUri;
    }
    else if (Utils.isString(options.dataUri)) {
      // Backward compatibility
      dataUri = {};
      dataUri[options.dataUriDefaultFormat || 'json'] = options.dataUri;
    }
    else {
      callback(new TypeError('Peaks.init(): The dataUri option must be an object'));
      return;
    }

    ['ArrayBuffer', 'JSON'].some(function(connector) {
      if (window[connector]) {
        requestType = connector.toLowerCase();
        url = dataUri[requestType];

        return Boolean(url);
      }
    });

    if (!url) {
      // eslint-disable-next-line max-len
      callback(new Error('Peaks.init(): Unable to determine a compatible dataUri format for this browser'));
      return;
    }

    var xhr = self._createXHR(url, requestType, options.withCredentials, function(event) {
      if (this.readyState !== 4) {
        return;
      }

      if (this.status !== 200) {
        callback(
          new Error('Unable to fetch remote data. HTTP status ' + this.status)
        );

        return;
      }

      var waveformData = new DynamicResampleWaveform(event.target.response, options.detailUriProvider);
      if (waveformData.channels !== 1 && waveformData.channels !== 2) {
        callback(new Error('Peaks.init(): Only mono or stereo waveforms are currently supported'));
        return;
      }

      callback(null, waveformData);
    },
    function() {
      callback(new Error('XHR Failed'));
    });

    xhr.send();
  };

  /* eslint-disable max-len */

  /**
   * Creates a waveform from given data, based on the given options.
   *
   * @private
   * @param {Object} options
   * @param {Object} options.waveformData
   * @param {ArrayBuffer} options.waveformData.arraybuffer Waveform data (binary format)
   * @param {Object} options.waveformData.json Waveform data (JSON format)
   * @param {WaveformBuilderInitCallback} callback
   *
   * @see Refer to the <a href="https://github.com/bbc/audiowaveform/blob/master/doc/DataFormat.md">data format documentation</a>
   *   for details of the binary and JSON waveform data formats.
   */

  /* eslint-enable max-len */

  WaveformBuilder.prototype._buildWaveformFromLocalData = function(options, callback) {
    var waveformData = null;
    var data = null;

    if (Utils.isObject(options.waveformData)) {
      waveformData = options.waveformData;
    }
    else {
      callback(new Error('Peaks.init(): The waveformData option must be an object'));
      return;
    }

    if (Utils.isObject(waveformData.json)) {
      data = waveformData.json;
    }
    else if (Utils.isArrayBuffer(waveformData.arraybuffer)) {
      data = waveformData.arraybuffer;
    }

    if (!data) {
      // eslint-disable-next-line max-len
      callback(new Error('Peaks.init(): Unable to determine a compatible waveformData format'));
      return;
    }

    try {
      var createdWaveformData = WaveformData.create(data);

      if (createdWaveformData.channels !== 1 && createdWaveformData.channels !== 2) {
        callback(new Error('Peaks.init(): Only mono or stereo waveforms are currently supported'));
        return;
      }

      callback(null, createdWaveformData);
    }
    catch (err) {
      callback(err);
    }
  };

  /**
   * Creates waveform data using the Web Audio API.
   *
   * @private
   * @param {Object} options
   * @param {AudioContext} options.audioContext
   * @param {HTMLMediaElement} options.mediaElement
   * @param {WaveformBuilderInitCallback} callback
   */

  WaveformBuilder.prototype._buildWaveformDataUsingWebAudio = function(options, callback) {
    var self = this;

    var audioContext = window.AudioContext || window.webkitAudioContext;

    if (!(options.webAudio.audioContext instanceof audioContext)) {
      // eslint-disable-next-line max-len
      callback(new TypeError('Peaks.init(): The webAudio.audioContext option must be a valid AudioContext'));
      return;
    }

    var webAudioOptions = options.webAudio;

    if (webAudioOptions.scale !== options.zoomLevels[0]) {
      webAudioOptions.scale = options.zoomLevels[0];
    }

    // If the media element has already selected which source to play, its
    // currentSrc attribute will contain the source media URL. Otherwise,
    // we wait for a canplay event to tell us when the media is ready.

    var mediaSourceUrl = self._peaks.options.mediaElement.currentSrc;

    if (mediaSourceUrl) {
      self._requestAudioAndBuildWaveformData(
        mediaSourceUrl,
        webAudioOptions,
        options.withCredentials,
        callback
      );
    }
    else {
      self._peaks.once('player.canplay', function() {
        self._requestAudioAndBuildWaveformData(
          self._peaks.options.mediaElement.currentSrc,
          webAudioOptions,
          options.withCredentials,
          callback
        );
      });
    }
  };

  WaveformBuilder.prototype._buildWaveformDataFromAudioBuffer = function(options, callback) {
    var webAudioOptions = options.webAudio;

    if (webAudioOptions.scale !== options.zoomLevels[0]) {
      webAudioOptions.scale = options.zoomLevels[0];
    }

    var webAudioBuilderOptions = {
      audio_buffer: webAudioOptions.audioBuffer,
      split_channels: webAudioOptions.multiChannel,
      scale: webAudioOptions.scale
    };

    WaveformData.createFromAudio(webAudioBuilderOptions, callback);
  };

  /**
   * Fetches the audio content, based on the given options, and creates waveform
   * data using the Web Audio API.
   *
   * @private
   * @param {url} The media source URL
   * @param {WaveformBuilderWebAudioOptions} webAudio
   * @param {Boolean} withCredentials
   * @param {WaveformBuilderInitCallback} callback
   */

  WaveformBuilder.prototype._requestAudioAndBuildWaveformData = function(url,
      webAudio, withCredentials, callback) {
    var self = this;

    if (!url) {
      self._peaks.logger('Peaks.init(): The mediaElement src is invalid');
      return;
    }

    var xhr = self._createXHR(url, 'arraybuffer', withCredentials, function(event) {
      if (this.readyState !== 4) {
        return;
      }

      if (this.status !== 200) {
        callback(
          new Error('Unable to fetch remote data. HTTP status ' + this.status)
        );

        return;
      }

      var webAudioBuilderOptions = {
        audio_context: webAudio.audioContext,
        array_buffer: event.target.response,
        split_channels: webAudio.multiChannel,
        scale: webAudio.scale
      };

      WaveformData.createFromAudio(webAudioBuilderOptions, callback);
    },
    function() {
      callback(new Error('XHR Failed'));
    });

    xhr.send();
  };

  /**
   * @private
   * @param {String} url
   * @param {String} requestType
   * @param {Boolean} withCredentials
   * @param {Function} onLoad
   * @param {Function} onError
   *
   * @returns {XMLHttpRequest}
   */

  WaveformBuilder.prototype._createXHR = function(url, requestType,
      withCredentials, onLoad, onError) {
    var xhr = new XMLHttpRequest();

    // open an XHR request to the data source file
    xhr.open('GET', url, true);

    if (isXhr2) {
      try {
        xhr.responseType = requestType;
      }
      catch (e) {
        // Some browsers like Safari 6 do handle XHR2 but not the json
        // response type, doing only a try/catch fails in IE9
      }
    }

    xhr.onload = onLoad;
    xhr.onerror = onError;

    if (isXhr2 && withCredentials) {
      xhr.withCredentials = true;
    }

    return xhr;
  };

  return WaveformBuilder;
});
