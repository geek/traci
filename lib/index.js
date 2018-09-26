'use strict';

const OpenTracing = require('opentracing');
const Package = require('../package.json');


exports.opentracing = OpenTracing;

exports.register = (server, options) => {
  const tracer = options.tracer || new OpenTracing.Tracer();

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

function onRequest (request, h) {
  const now = Date.now();

  request.spans = {};
  const span = request.server.tracer.startSpan('hapi_request', { startTime: now });

  span.setTag('method', request.method);
  span.setTag('path', request.path);
  span.log({ event: 'onRequest', headers: request.headers, path: request.path, method: request.method, info: request.info }, now);

  request.spans[`request_${request.info.id}`] = span;

  return h.continue;
}

function onPreAuth (request, h) {
  const now = Date.now();

  const span = request.server.tracer.startSpan('hapi_auth', { childOf: request.span().context(), startTime: now });
  span.log({ event: 'onPreAuth' }, now);
  request.spans[`auth_${request.info.id}`] = span;

  return h.continue;
}

function onPostAuth (request, h) {
  const now = Date.now();

  const authSpan = request.spans[`auth_${request.info.id}`];
  authSpan.log({ event: 'onPostAuth', auth: request.auth }, now);
  authSpan.finish(now);

  return h.continue;
}

function onPreHandler (request, h) {
  const now = Date.now();

  const span = request.server.tracer.startSpan('hapi_handler', { childOf: request.span().context(), startTime: now });
  span.log({ event: 'onPreHandler', path: request.route.path, method: request.route.method }, now);
  request.spans[`handler_${request.info.id}`] = span;

  return h.continue;
}

function onPreResponse (request, h) {
  const now = Date.now();

  // won't exist when a handler isn't found
  if (request.spans[`handler_${request.info.id}`]) {
    request.spans[`handler_${request.info.id}`].finish(now);
  }

  const span = request.server.tracer.startSpan('hapi_response', { childOf: request.span().context(), startTime: now });
  request.spans[`response_${request.info.id}`] = span;
  span.log({ event: 'onPreResponse', path: request.path, method: request.method, info: request.info }, now);

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
  return this.spans[`${spanKind}_${this.info.id}`];
}
