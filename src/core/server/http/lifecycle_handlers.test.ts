/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0 and the Server Side Public License, v 1; you may not use this file except
 * in compliance with, at your election, the Elastic License 2.0 or the Server
 * Side Public License, v 1.
 */

import type { KibanaRequest, RouteMethod, KibanaRouteOptions } from '@kbn/core-http-server';
import {
  createCustomHeadersPreResponseHandler,
  createVersionCheckPostAuthHandler,
  createXsrfPostAuthHandler,
} from './lifecycle_handlers';
import { httpServerMock } from './http_server.mocks';
import { HttpConfig } from './http_config';

const createConfig = (partial: Partial<HttpConfig>): HttpConfig => partial as HttpConfig;

const forgeRequest = ({
  headers = {},
  path = '/',
  method = 'get',
  kibanaRouteOptions,
}: Partial<{
  headers: Record<string, string>;
  path: string;
  method: RouteMethod;
  kibanaRouteOptions: KibanaRouteOptions;
}>): KibanaRequest => {
  return httpServerMock.createKibanaRequest({
    headers,
    path,
    method,
    kibanaRouteOptions,
  });
};

describe('xsrf post-auth handler', () => {
  let toolkit: ReturnType<typeof httpServerMock.createToolkit>;
  let responseFactory: ReturnType<typeof httpServerMock.createLifecycleResponseFactory>;

  beforeEach(() => {
    toolkit = httpServerMock.createToolkit();
    responseFactory = httpServerMock.createLifecycleResponseFactory();
  });

  describe('non destructive methods', () => {
    it('accepts requests without version or xsrf header', () => {
      const config = createConfig({ xsrf: { allowlist: [], disableProtection: false } });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'get', headers: {} });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });
  });

  describe('destructive methods', () => {
    it('accepts requests with xsrf header', () => {
      const config = createConfig({ xsrf: { allowlist: [], disableProtection: false } });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'post', headers: { 'kbn-xsrf': 'xsrf' } });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });

    it('accepts requests with version header', () => {
      const config = createConfig({ xsrf: { allowlist: [], disableProtection: false } });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'post', headers: { 'kbn-version': 'some-version' } });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });

    it('returns a bad request if called without xsrf or version header', () => {
      const config = createConfig({ xsrf: { allowlist: [], disableProtection: false } });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'post' });

      responseFactory.badRequest.mockReturnValue('badRequest' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(toolkit.next).not.toHaveBeenCalled();
      expect(responseFactory.badRequest).toHaveBeenCalledTimes(1);
      expect(responseFactory.badRequest.mock.calls[0][0]).toMatchInlineSnapshot(`
        Object {
          "body": "Request must contain a kbn-xsrf header.",
        }
      `);
      expect(result).toEqual('badRequest');
    });

    it('accepts requests if protection is disabled', () => {
      const config = createConfig({ xsrf: { allowlist: [], disableProtection: true } });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'post', headers: {} });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });

    it('accepts requests if path is allowlisted', () => {
      const config = createConfig({
        xsrf: { allowlist: ['/some-path'], disableProtection: false },
      });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({ method: 'post', headers: {}, path: '/some-path' });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });

    it('accepts requests if xsrf protection on a route is disabled', () => {
      const config = createConfig({
        xsrf: { allowlist: [], disableProtection: false },
      });
      const handler = createXsrfPostAuthHandler(config);
      const request = forgeRequest({
        method: 'post',
        headers: {},
        path: '/some-path',
        kibanaRouteOptions: {
          xsrfRequired: false,
        },
      });

      toolkit.next.mockReturnValue('next' as any);

      const result = handler(request, responseFactory, toolkit);

      expect(responseFactory.badRequest).not.toHaveBeenCalled();
      expect(toolkit.next).toHaveBeenCalledTimes(1);
      expect(result).toEqual('next');
    });
  });
});

describe('versionCheck post-auth handler', () => {
  let toolkit: ReturnType<typeof httpServerMock.createToolkit>;
  let responseFactory: ReturnType<typeof httpServerMock.createLifecycleResponseFactory>;

  beforeEach(() => {
    toolkit = httpServerMock.createToolkit();
    responseFactory = httpServerMock.createLifecycleResponseFactory();
  });

  it('forward the request to the next interceptor if header matches', () => {
    const handler = createVersionCheckPostAuthHandler('actual-version');
    const request = forgeRequest({ headers: { 'kbn-version': 'actual-version' } });

    toolkit.next.mockReturnValue('next' as any);

    const result = handler(request, responseFactory, toolkit);

    expect(toolkit.next).toHaveBeenCalledTimes(1);
    expect(responseFactory.badRequest).not.toHaveBeenCalled();
    expect(result).toBe('next');
  });

  it('returns a badRequest error if header does not match', () => {
    const handler = createVersionCheckPostAuthHandler('actual-version');
    const request = forgeRequest({ headers: { 'kbn-version': 'another-version' } });

    responseFactory.badRequest.mockReturnValue('badRequest' as any);

    const result = handler(request, responseFactory, toolkit);

    expect(toolkit.next).not.toHaveBeenCalled();
    expect(responseFactory.badRequest).toHaveBeenCalledTimes(1);
    expect(responseFactory.badRequest.mock.calls[0][0]).toMatchInlineSnapshot(`
      Object {
        "body": Object {
          "attributes": Object {
            "expected": "actual-version",
            "got": "another-version",
          },
          "message": "Browser client is out of date, please refresh the page (\\"kbn-version\\" header was \\"another-version\\" but should be \\"actual-version\\")",
        },
      }
    `);
    expect(result).toBe('badRequest');
  });

  it('forward the request to the next interceptor if header is not present', () => {
    const handler = createVersionCheckPostAuthHandler('actual-version');
    const request = forgeRequest({ headers: {} });

    toolkit.next.mockReturnValue('next' as any);

    const result = handler(request, responseFactory, toolkit);

    expect(toolkit.next).toHaveBeenCalledTimes(1);
    expect(responseFactory.badRequest).not.toHaveBeenCalled();
    expect(result).toBe('next');
  });
});

describe('customHeaders pre-response handler', () => {
  let toolkit: ReturnType<typeof httpServerMock.createToolkit>;

  beforeEach(() => {
    toolkit = httpServerMock.createToolkit();
  });

  it('adds the kbn-name header to the response', () => {
    const config = createConfig({ name: 'my-server-name' });
    const handler = createCustomHeadersPreResponseHandler(config as HttpConfig);

    handler({} as any, {} as any, toolkit);

    expect(toolkit.next).toHaveBeenCalledTimes(1);
    expect(toolkit.next).toHaveBeenCalledWith({ headers: { 'kbn-name': 'my-server-name' } });
  });

  it('adds the security headers and custom headers defined in the configuration', () => {
    const config = createConfig({
      name: 'my-server-name',
      securityResponseHeaders: {
        headerA: 'value-A',
        headerB: 'value-B', // will be overridden by the custom response header below
      },
      customResponseHeaders: {
        headerB: 'x',
      },
    });
    const handler = createCustomHeadersPreResponseHandler(config as HttpConfig);

    handler({} as any, {} as any, toolkit);

    expect(toolkit.next).toHaveBeenCalledTimes(1);
    expect(toolkit.next).toHaveBeenCalledWith({
      headers: {
        'kbn-name': 'my-server-name',
        headerA: 'value-A',
        headerB: 'x',
      },
    });
  });

  it('preserve the kbn-name value from server.name if defined in custom headders ', () => {
    const config = createConfig({
      name: 'my-server-name',
      customResponseHeaders: {
        'kbn-name': 'custom-name',
        headerA: 'value-A',
        headerB: 'value-B',
      },
    });
    const handler = createCustomHeadersPreResponseHandler(config as HttpConfig);

    handler({} as any, {} as any, toolkit);

    expect(toolkit.next).toHaveBeenCalledTimes(1);
    expect(toolkit.next).toHaveBeenCalledWith({
      headers: {
        'kbn-name': 'my-server-name',
        headerA: 'value-A',
        headerB: 'value-B',
      },
    });
  });
});
