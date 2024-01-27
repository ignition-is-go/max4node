outlets = 2;

var sidecar_led = this.patcher.getnamed('sidecar_led');
var rship_led = this.patcher.getnamed('rship_led');
var rship_latency = this.patcher.getnamed('rshiplatency');
var me = this.patcher.getnamed('devicestatus');
var ableton_targets = this.patcher.getnamed('ableton_targets');

function setBackgroundColor(el, r, g, b) {
  el.message('offcolor', r, g, b);
}

function setLedGreen(el) {
  setBackgroundColor(el, 0, 0.7, 0);
}

function setLedRed(el) {
  setBackgroundColor(el, 0.7, 0, 0);
}

function setRshipStatus(online) {
  if (online) {
    setLedGreen(rship_led);
  } else {
    setLedRed(rship_led);
  }
}

function setSidecarStatus(online) {
  if (online) {
    setLedGreen(sidecar_led);
  } else {
    setLedRed(sidecar_led);
  }
}

var sidecar_sequence = 0;
var sidecar_pong = 0;

function ping() {
  outlet(0, '/ping', ++sidecar_sequence);
  log('ping', sidecar_sequence);
  me.message('getstate');
  if (sidecar_sequence - sidecar_pong > 1) {
    setSidecarStatus(false);
    setRshipStatus(false);
    rship_latency.message('set');
    ableton_targets.message('set');
  } else {
    setSidecarStatus(true);
  }
}

var isReady = false,
  actions = {},
  apis = {};

function get(action) {
  var json = Array.prototype.slice.call(arguments);

  json = json.slice(1);

  if (action === '/pong') {
    setSidecarStatus(true);
    log('pong', arguments[1]);
    sidecar_pong = parseInt(arguments[1]);
    return;
  }
  if (action === '/set_field') {
    const field = arguments[1];
    const value = arguments[2];
    log('set_field', field, value);
    if (field == 'rs_ping') {
      rship_latency.message('set', value);
    }
    if (field == 'rs_online') {
      setRshipStatus(value === 1);
    }
    if (field === 'rs_targets') {
      ableton_targets.message('set', value);
    }

    return;
  }

  action = action.slice(1);
  var ret = actions[action](json);
}

function on(a) {
  log('device on', a);
  isReady = a === 1;
}

actions['get'] = function (obj) {
  var path = obj[0],
    property = obj[1],
    callback = obj[2];

  var api = getApi(path);
  outlet(1, 'bang');
  outlet(0, '/_get_reply', callback, api.get(property));
};

actions['set'] = function (obj) {
  var path = obj[0],
    property = obj[1],
    value = obj[2];

  var api = getApi(path);
  api.set(property, value);
};

actions['call'] = function (obj) {
  var path = obj[0],
    method = obj[1],
    callback = obj[2];
  var api = getApi(path);

  outlet(1, 'bang');
  outlet(0, '/_call_reply', callback, api.call(method));
};

actions['observe'] = function (obj) {
  var path = obj[0],
    property = obj[1],
    callback = obj[2];

  var handler = handleCallbacks(callback);
  var api = new LiveAPI(handler, path);
  api.property = property;
};

actions['count'] = function (obj) {
  var path = obj[0],
    property = obj[1],
    callback = obj[2];

  var api = getApi(path);

  outlet(1, 'bang');
  outlet(0, '/_get_reply', callback, api.getcount(property));
};

function getApi(path) {
  if (apis[path]) return apis[path];

  apis[path] = new LiveAPI(path);
  return apis[path];
}

function handleCallbacks(callback) {
  return function (value) {
    outlet(1, 'bang');
    outlet(0, '/_observer_reply', callback, value);
  };
}

function log() {
  for (var i = 0, len = arguments.length; i < len; i++) {
    var message = arguments[i];
    if (message && message.toString) {
      var s = message.toString();
      if (s.indexOf('[object ') >= 0) {
        s = JSON.stringify(message);
      }
      post(s);
    } else if (message === null) {
      post('<null>');
    } else {
      post(message);
    }
  }
  post('\n');
}
