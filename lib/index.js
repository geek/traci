'use strict';

const Hoek = require('@hapi/hoek');
const OpenTracing = require('opentracing');
const Package = require('../package.json');
const { FORMAT_HTTP_HEADERS } = require('opentracing');


const internals = {};

exports.opentracing = OpenTracing;

exports.register = (server, options) => {
  const settings = Object.assign({}, internals.defaults, options);
  const tracer = options.tracer || new OpenTracing.Tracer();

  // Validate and preparse the event inputs to prevent needing to do it at
  // runtime.
  Object.keys(settings).forEach((key) => {
    // TODO: The input schema should probably not include 'tracer' in the same
    // object as the event inputs.
    if (key === 'tracer') {
      return;
    }

    Hoek.assert(Array.isArray(settings[key]));
    settings[key] = settings[key].map((prop) => {
      Hoek.assert(typeof prop === 'string');
      const pathParts = prop.split('.');

      // TODO: Should probably throw if the same 'key' is computed, as that
      // value is used to key an object at runtime, and it would result in
      // data potentially being overwritten.
      return {
        fullPath: prop,
        key: pathParts[pathParts.length - 1]
      };
    });
  });

  server.decorate('request', 'pickSpanLog', createPickSpanLog(settings));
  server.decorate('request', 'span', requestSpan);
  server.decorate('server', 'tracer', tracer);
  server.ext('onRequest', onRequest);
  server.ext('onPreAuth', onPreAuth);
  server.ext('onPostAuth', onPostAuth);
  server.ext('onPreHandler', onPreHandler);
  server.ext('onPreResponse', onPreResponse);
  server.events.on('log', onLog(tracer));
  server.events.on('response', onResponse);
};

exports.pkg = Package;

internals.defaults = {
  onRequest: ['headers', 'info'],
  onPostAuth: ['auth'],
  onPreHandler: ['route.settings.handler.name'],
  onPreResponse: ['info']
};

function createPickSpanLog (settings) {
  const pickSpanLog = function (event) {
    const request = this;
    const result = {};
    const propKeyPaths = settings[event];

    if (propKeyPaths === undefined) {
      return result;
    }

    for (const keyPath of propKeyPaths) {
      result[keyPath.key] = Hoek.reach(request, keyPath.fullPath);
    }

    return result;
  };

  return pickSpanLog;
}

function onRequest (request, h) {
  const now = Date.now();
  const tracer = request.server.tracer;
  const headers = {};
  let span = tracer.startSpan('hapi_request', { startTime: now });
  request.plugins.traci = { spans: new Map() };

  try {
    const parentSpanContext = tracer.extract(FORMAT_HTTP_HEADERS, request.headers);
    if (parentSpanContext) {
      span = tracer.startSpan('hapi_request', { startTime: now, childOf: parentSpanContext });
    }

    tracer.inject(span, FORMAT_HTTP_HEADERS, headers);
  } catch (ex) {
    request.log(['error', 'debug'], ex);
  }

  span.setTag('method', request.method);
  span.setTag('path', request.path);

  const event = 'onRequest';
  span.log({ event, ...request.pickSpanLog(event) }, now);
  request.plugins.traci.spans.set(`request_${request.info.id}`, span);
  return h.continue;
}

function onPreAuth (request, h) {
  const now = Date.now();

  const span = request.server.tracer.startSpan('hapi_auth', {
    childOf: request.span().context(),
    startTime: now
  });

  const event = 'onPreAuth';
  span.log({ event, ...request.pickSpanLog(event) }, now);
  request.plugins.traci.spans.set(`auth_${request.info.id}`, span);

  return h.continue;
}

function onPostAuth (request, h) {
  const now = Date.now();

  const span = request.plugins.traci.spans.get(`auth_${request.info.id}`);
  const event = 'onPostAuth';
  span.log({ event, ...request.pickSpanLog(event) }, now);
  span.finish(now);

  return h.continue;
}

function onPreHandler (request, h) {
  const now = Date.now();

  const span = request.server.tracer.startSpan('hapi_handler', {
    childOf: request.span().context(),
    startTime: now
  });
  const event = 'onPreHandler';
  span.log({ event, ...request.pickSpanLog(event) }, now);
  request.plugins.traci.spans.set(`handler_${request.info.id}`, span);

  return h.continue;
}

function onPreResponse (request, h) {
  const now = Date.now();

  // won't exist if a handler isn't found
  if (request.plugins.traci.spans.has(`handler_${request.info.id}`)) {
    request.plugins.traci.spans.get(`handler_${request.info.id}`).finish(now);
  }

  const span = request.server.tracer.startSpan('hapi_response', {
    childOf: request.span().context(),
    startTime: now
  });
  request.plugins.traci.spans.set(`response_${request.info.id}`, span);

  const event = 'onPreResponse';
  span.log({ event, ...request.pickSpanLog(event) }, now);

  const response = request.response;
  if (response.isBoom) {
    span.log({ event: 'error', output: response.output, stack: response.stack }, now);
  }

  return h.continue;
}

function onResponse (request) {
  const now = Date.now();

  for (const type of ['request', 'auth', 'handler', 'response']) {
    const span = request.span(type);
    if (span && span._duration === undefined && !span._finishMs) {
      span.finish(now);
    }
  }
}

function onLog (tracer) {
  return (event, tags) => {
    const now = Date.now();

    const span = tracer.startSpan('hapi_log', { startTime: now });
    span.log({ event, tags }, now);
    span.finish();
  };
}

function requestSpan (spanKind = 'request') {
  return this.plugins.traci.spans.get(`${spanKind}_${this.info.id}`);
}
