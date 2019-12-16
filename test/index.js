'use strict';

const Lab = require('@hapi/lab');
const { expect } = require('@hapi/code');
const Hapi = require('@hapi/hapi');
const { MockTracer } = require('opentracing/lib/mock_tracer'); // because opentracing doesn't like to do releases
const Traci = require('../');

const lab = exports.lab = Lab.script();
const { describe, it } = lab;

describe('traci', () => {
  it('can be registered with hapi', async () => {
    const server = new Hapi.Server();
    await server.register(Traci);
    expect(server.tracer).to.exist();
  });

  it('a span can be accessed in a route', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.route({
      method: 'get',
      path: '/',
      handler: (request, h) => {
        return h.response({ foo: 'bar' });
      }
    });

    await server.initialize();
    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.debugSpans[0].operation).to.equal('hapi_request');
  });

  it('a http trace header is set as the parent span ID', async () => {
    let extracted = false;
    const tracer = new MockTracer();
    const parentSpan = tracer.startSpan('parent');

    tracer.__proto__.extract = function () { // eslint-disable-line no-proto
      tracer.__proto__.extract = undefined; // eslint-disable-line no-proto
      extracted = true;
      return parentSpan.context();
    };

    tracer.__proto__.inject = function (span, format, headers) { // eslint-disable-line no-proto
      expect(span._uuid).to.equal(parentSpan._uuid);
    };

    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer
      }
    });

    server.route({
      method: 'get',
      path: '/',
      handler: (request, h) => {
        return h.response({ foo: 'bar' });
      }
    });

    await server.initialize();
    await server.inject({
      url: '/',
      headers: {
        'uber-trace-id': parentSpan._uuid
      }
    });
    expect(extracted).to.be.true();
  });

  it('when unable to extract parent span from http header there isn\'t a parent', async () => {
    let extracted = false;
    const tracer = new MockTracer();

    tracer.__proto__.extract = function () { // eslint-disable-line no-proto
      tracer.__proto__.extract = undefined; // eslint-disable-line no-proto
      extracted = true;
      return null;
    };

    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer
      }
    });

    server.route({
      method: 'get',
      path: '/',
      handler: (request, h) => {
        return h.response({ foo: 'bar' });
      }
    });

    await server.initialize();
    await server.inject('/');
    expect(extracted).to.be.true();
  });

  it('works correctly on a not found route', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.debugSpans[0].operation).to.equal('hapi_request');
  });

  it('creates an error span for an error response', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.route({
      method: 'get',
      path: '/',
      handler: (request, h) => {
        throw new Error('foo');
      }
    });

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.debugSpans[0].operation).to.equal('hapi_request');
    expect(report.debugSpans[0].tags.path).to.equal('/');
    expect(report.debugSpans[0].tags.method).to.equal('get');
    expect(report.spans[3]._operationName).to.equal('hapi_response');
    expect(report.spans[3]._logs[1].fields.stack).to.contain('foo');
  });

  it('handles internal reroutes using server.inject (decorated request)', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.route([
      {
        method: 'get',
        path: '/',
        handler: async (request, h) => {
          const res = await request.server.inject('/reroute');
          return res.payload;
        }
      },
      {
        method: 'get',
        path: '/reroute',
        handler: (request, h) => {
          const span = request.server.tracer.startSpan('reroute', { childOf: request.span('handler').context() });
          span.finish();
          return 'foo';
        }
      }
    ]);

    await server.inject('/');
    await server.inject('/reroute');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.spans.length).to.equal(14);
  });

  it('will not finish a span that is already marked as finished', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.route([
      {
        method: 'get',
        path: '/',
        handler: async (request, h) => {
          const res = await request.server.inject('/reroute');
          return res.payload;
        }
      },
      {
        method: 'get',
        path: '/reroute',
        handler: (request, h) => {
          request.plugins.traci.spans.values().next().value._duration = 10;
          return 'foo';
        }
      }
    ]);

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(1);
    expect(report.spans.length).to.equal(8);
  });

  it('handles internal reroutes using server.inject and not found routes', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.route([
      {
        method: 'get',
        path: '/',
        handler: async (request, h) => {
          const res = await request.server.inject('/reroute');
          return res.payload;
        }
      }
    ]);

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
  });

  it('a log span is created when logging is performed', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.log('test');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.debugSpans[0].operation).to.equal('hapi_log');
  });

  it('includes auth details when auth is configured', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer()
      }
    });

    server.auth.scheme('testauth', function (server) {
      return {
        authenticate: function (request, h) {
          return h.authenticated({ credentials: { user: 'test' } });
        }
      };
    });

    server.auth.strategy('testauth', 'testauth');

    server.route([
      {
        method: 'get',
        path: '/',
        config: {
          auth: 'testauth',
          handler: (request, h) => {
            return { foo: 'bar' };
          }
        }
      }
    ]);

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.spans[1]._logs[1].fields.auth.credentials.user).to.equal('test');
  });

  it('can override logged properties for onPostAuth', async () => {
    const server = new Hapi.Server();
    await server.register({
      plugin: Traci,
      options: {
        tracer: new MockTracer(),
        onPostAuth: ['auth.credentials.user']
      }
    });

    server.auth.scheme('testauth', function (server) {
      return {
        authenticate: function (request, h) {
          return h.authenticated({ credentials: { user: 'test' } });
        }
      };
    });

    server.auth.strategy('testauth', 'testauth');

    server.route([
      {
        method: 'get',
        path: '/',
        config: {
          auth: 'testauth',
          handler: (request, h) => {
            return { foo: 'bar' };
          }
        }
      }
    ]);

    await server.inject('/');
    const report = server.tracer.report();
    expect(report.unfinishedSpans.length).to.equal(0);
    expect(report.spans[1]._logs[1].fields.user).to.equal('test');
  });
});
