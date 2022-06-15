/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import type { Logger } from '@kbn/core/server';
import { set } from 'lodash';
import { elasticsearchServiceMock, loggingSystemMock } from '@kbn/core/server/mocks';
import { ContentStream, ContentStreamEncoding, ContentStreamParameters } from './content_stream';
import { BlobAttributes } from '../../../types';

describe('ContentStream', () => {
  let client: ReturnType<typeof elasticsearchServiceMock.createElasticsearchClient>;
  let logger: Logger;
  let stream: ContentStream;
  let base64Stream: ContentStream;

  const getContentStream = ({
    id = 'something',
    index = 'somewhere',
    params = {
      encoding: 'base64' as ContentStreamEncoding,
      size: 1,
    } as ContentStreamParameters,
    attributes = [] as BlobAttributes,
  } = {}) => {
    return new ContentStream(client, id, index, logger, params, attributes);
  };

  beforeEach(() => {
    client = elasticsearchServiceMock.createClusterClient().asInternalUser;
    logger = loggingSystemMock.createLogger();
    client.get.mockResponse(set<any>({}, '_source.data', 'some content'));
  });

  describe('read', () => {
    beforeEach(() => {
      stream = getContentStream({ params: { encoding: 'raw', size: 1 } });
      base64Stream = getContentStream();
    });

    it('should perform a search using index and the document id', async () => {
      await new Promise((resolve) => stream.once('data', resolve));

      expect(client.get).toHaveBeenCalledTimes(1);

      const [[request]] = client.get.mock.calls;
      expect(request).toHaveProperty('index', 'somewhere');
      expect(request).toHaveProperty('id', '0.something');
    });

    it('should read the document contents', async () => {
      const data = await new Promise((resolve) => stream.once('data', resolve));

      expect(data).toEqual(Buffer.from('some content'));
    });

    it('should be an empty stream on empty response', async () => {
      client.get.mockResponseOnce({} as any);
      const onData = jest.fn();

      stream.on('data', onData);
      await new Promise((resolve) => stream.once('end', resolve));

      expect(onData).not.toHaveBeenCalled();
    });

    it('should emit an error event', async () => {
      client.get.mockRejectedValueOnce('some error');

      stream.read();
      const error = await new Promise((resolve) => stream.once('error', resolve));

      expect(error).toBe('some error');
    });

    it('should decode base64 encoded content', async () => {
      client.get.mockResponseOnce(
        set<any>({}, '_source.data', Buffer.from('encoded content').toString('base64'))
      );
      const data = await new Promise((resolve) => base64Stream.once('data', resolve));

      expect(data).toEqual(Buffer.from('encoded content'));
    });

    it('should compound content from multiple chunks', async () => {
      client.get.mockResponseOnce(set<any>({}, '_source.data', '12'));
      client.get.mockResponseOnce(set<any>({}, '_source.data', '34'));
      client.get.mockResponseOnce(set<any>({}, '_source.data', '56'));
      stream = getContentStream({
        params: { encoding: 'raw', size: 6 },
      });
      let data = '';
      for await (const chunk of stream) {
        data += chunk;
      }

      expect(data).toEqual('123456');
      expect(client.get).toHaveBeenCalledTimes(3);

      const [[request1], [request2], [request3]] = client.get.mock.calls;

      expect(request1).toHaveProperty('index', 'somewhere');
      expect(request1).toHaveProperty('id', '0.something');
      expect(request2).toHaveProperty('index', 'somewhere');
      expect(request2).toHaveProperty('id', '1.something');
      expect(request3).toHaveProperty('index', 'somewhere');
      expect(request3).toHaveProperty('id', '2.something');
    });

    it('should stop reading on empty chunk', async () => {
      client.get.mockResponseOnce(set<any>({}, '_source.data', '12'));
      client.get.mockResponseOnce(set<any>({}, '_source.data', '34'));
      client.get.mockResponseOnce(set<any>({}, '_source.data', ''));
      stream = getContentStream({ params: { encoding: 'raw', size: 12 } });
      let data = '';
      for await (const chunk of stream) {
        data += chunk;
      }

      expect(data).toEqual('1234');
      expect(client.get).toHaveBeenCalledTimes(3);
    });

    it('should read until chunks are present when there is no size', async () => {
      client.get.mockResponseOnce(set<any>({}, '_source.data', '12'));
      client.get.mockResponseOnce(set<any>({}, '_source.data', '34'));
      client.get.mockResponseOnce({} as any);
      stream = getContentStream({ params: { size: undefined, encoding: 'raw' } });
      let data = '';
      for await (const chunk of stream) {
        data += chunk;
      }

      expect(data).toEqual('1234');
      expect(client.get).toHaveBeenCalledTimes(3);
    });

    it('should decode every chunk separately', async () => {
      client.get.mockResponseOnce(
        set<any>({}, '_source.data', Buffer.from('12').toString('base64'))
      );
      client.get.mockResponseOnce(
        set<any>({}, '_source.data', Buffer.from('34').toString('base64'))
      );
      client.get.mockResponseOnce(
        set<any>({}, '_source.data', Buffer.from('56').toString('base64'))
      );
      client.get.mockResponseOnce(set<any>({}, '_source.data', ''));
      base64Stream = getContentStream({ params: { size: 12 } });
      let data = '';
      for await (const chunk of base64Stream) {
        data += chunk;
      }

      expect(data).toEqual('123456');
    });
  });

  describe('write', () => {
    beforeEach(() => {
      stream = getContentStream({ params: { encoding: 'raw', size: 1 } });
      base64Stream = getContentStream();
    });
    it('should not send a request until stream is closed', () => {
      stream.write('something');

      expect(client.update).not.toHaveBeenCalled();
    });

    it('should provide a document ID after writing to a destination', async () => {
      stream = new ContentStream(client, undefined, 'somewhere', logger);
      expect(stream.getContentReferenceId()).toBe(undefined);
      stream.end('some data');
      await new Promise((resolve) => stream.once('finish', resolve));
      expect(stream.getContentReferenceId()).toEqual(expect.any(String));
    });

    it('should send the contents when stream ends', async () => {
      stream.write('123');
      stream.write('456');
      stream.end();
      await new Promise((resolve) => stream.once('finish', resolve));

      expect(client.index).toHaveBeenCalledTimes(1);

      const [[request]] = client.index.mock.calls;

      expect(request).toHaveProperty('id', '0.something');
      expect(request).toHaveProperty('index', 'somewhere');
      expect(request).toHaveProperty('document.data', '123456');
    });

    it('should update a number of written bytes', async () => {
      stream.write('123');
      stream.write('456');
      stream.end();
      await new Promise((resolve) => stream.once('finish', resolve));

      expect(stream.bytesWritten).toBe(6);
    });

    it('should emit an error event', async () => {
      client.index.mockRejectedValueOnce('some error');

      stream.end('data');
      const error = await new Promise((resolve) => stream.once('error', resolve));

      expect(error).toBe('some error');
    });

    it('should remove all previous chunks before writing', async () => {
      stream.end('12345');
      await new Promise((resolve) => stream.once('finish', resolve));

      expect(client.deleteByQuery).toHaveBeenCalledTimes(1);

      const [[request]] = client.deleteByQuery.mock.calls;

      expect(request).toHaveProperty('index', 'somewhere');
      expect(request).toHaveProperty('query.bool.should.0.match.head_chunk_id', '0.something');
      expect(request).toHaveProperty('query.bool.should.1.match._id', '0.something');
    });

    it('should split raw data into chunks', async () => {
      stream = getContentStream({ params: { encoding: 'raw', maxChunkSize: '1028B' } });
      stream.end('123456');
      await new Promise((resolve) => stream.once('finish', resolve));

      expect(client.index).toHaveBeenCalledTimes(3);
      expect(client.index).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining(set({}, 'document.data', '12'))
      );
      expect(client.index).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: '1.something',
          index: 'somewhere',
          document: {
            head_chunk_id: '0.something',
            data: '34',
          },
        })
      );
      expect(client.index).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          id: '2.something',
          index: 'somewhere',
          document: {
            head_chunk_id: '0.something',
            data: '56',
          },
        })
      );
    });

    it('should encode every chunk separately', async () => {
      base64Stream = getContentStream({ params: { encoding: 'base64', maxChunkSize: '1028B' } });
      base64Stream.end('12345678');
      await new Promise((resolve) => base64Stream.once('finish', resolve));

      expect(client.index).toHaveBeenCalledTimes(3);
      expect(client.index).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining(set({}, 'document.data', Buffer.from('123').toString('base64')))
      );
      expect(client.index).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: '1.something',
          index: 'somewhere',
          document: {
            data: Buffer.from('456').toString('base64'),
            head_chunk_id: '0.something',
          },
        })
      );
      expect(client.index).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          id: '2.something',
          index: 'somewhere',
          document: {
            data: Buffer.from('78').toString('base64'),
            head_chunk_id: '0.something',
          },
        })
      );
    });

    it('should clear the job contents on writing empty data', async () => {
      stream.end();
      await new Promise((resolve) => stream.once('finish', resolve));

      expect(client.deleteByQuery).toHaveBeenCalledTimes(1);
      expect(client.index).toHaveBeenCalledTimes(0);

      const [[deleteRequest]] = client.deleteByQuery.mock.calls;

      expect(deleteRequest).toHaveProperty(
        'query.bool.should.0.match.head_chunk_id',
        '0.something'
      );
      expect(deleteRequest).toHaveProperty('query.bool.should.1.match._id', '0.something');
    });

    it('should store the attributes on the first document it creates', async () => {
      base64Stream = getContentStream({
        attributes: [['myName', 'myValue']],
        params: { encoding: 'base64', maxChunkSize: '1028B' },
      });
      base64Stream.end('12345678');
      await new Promise((resolve) => base64Stream.once('finish', resolve));

      const expectedAttributeData = {
        app_metadata: { myName: 'myValue' },
      };

      expect(client.index).toHaveBeenCalledTimes(3);
      expect(client.index).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          id: '0.something',
          index: 'somewhere',
          document: {
            data: Buffer.from('123').toString('base64'),
            ...expectedAttributeData,
          },
        })
      );
      expect(client.index).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          id: '1.something',
          index: 'somewhere',
          document: {
            data: Buffer.from('456').toString('base64'),
            head_chunk_id: '0.something',
          },
        })
      );
      expect(client.index).toHaveBeenNthCalledWith(
        2,
        expect.not.objectContaining({
          document: {
            ...expectedAttributeData,
          },
        })
      );
      // Non-head chunks should not contain attributes
      expect(client.index).toHaveBeenNthCalledWith(
        3,
        expect.objectContaining({
          id: '2.something',
          index: 'somewhere',
          document: {
            data: Buffer.from('78').toString('base64'),
            head_chunk_id: '0.something',
          },
        })
      );
      // Non-head chunks should not contain attributes
      expect(client.index).toHaveBeenNthCalledWith(
        3,
        expect.not.objectContaining({
          document: {
            ...expectedAttributeData,
          },
        })
      );
    });

    it('should not allow duplicate attribute names', async () => {
      base64Stream = getContentStream({
        attributes: [
          ['myName', 'myValue'],
          ['myName', 'myOtherValue'],
        ],
        params: { encoding: 'base64', maxChunkSize: '1028B' },
      });
      base64Stream.end('12345678');
      const error = await new Promise((resolve) => base64Stream.once('error', resolve));
      expect(error).toEqual(
        new Error('Duplicate attributes are not allowed. Found duplicate name "myName".')
      );
    });
  });
});
