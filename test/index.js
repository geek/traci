'use strict';

const Lab = require('lab');
const { expect } = require('code');
const Hapi = require('hapi');
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
    expect(report.spans[3]._operationName).to.equal('hapi_response');
    expect(report.spans[3]._logs[1].fields.stack).to.contain('foo');
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
});
