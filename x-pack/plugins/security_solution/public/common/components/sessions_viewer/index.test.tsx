/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import React, { useEffect } from 'react';
import { waitFor, render } from '@testing-library/react';
import { TestProviders } from '../../mock';
import { TEST_ID, SessionsView, defaultSessionsFilter } from '.';
import type { EntityType } from '@kbn/timelines-plugin/common';
import { TimelineId } from '@kbn/timelines-plugin/common';
import type { SessionsComponentsProps } from './types';
import type { TimelineModel } from '../../../timelines/store/timeline/model';
import { useGetUserCasesPermissions } from '../../lib/kibana';

jest.mock('../../lib/kibana');

const originalKibanaLib = jest.requireActual('../../lib/kibana');

// Restore the useGetUserCasesPermissions so the calling functions can receive a valid permissions object
// The returned permissions object will indicate that the user does not have permissions by default
const mockUseGetUserCasesPermissions = useGetUserCasesPermissions as jest.Mock;
mockUseGetUserCasesPermissions.mockImplementation(originalKibanaLib.useGetUserCasesPermissions);

jest.mock('../url_state/normalize_time_range');

const startDate = '2022-03-22T22:10:56.794Z';
const endDate = '2022-03-21T22:10:56.791Z';

const filterQuery =
  '{"bool":{"must":[],"filter":[{"match_phrase":{"host.name":{"query":"ubuntu-impish"}}}],"should":[],"must_not":[]}}';

const testProps: SessionsComponentsProps = {
  timelineId: TimelineId.hostsPageSessions,
  entityType: 'sessions',
  pageFilters: [],
  startDate,
  endDate,
  filterQuery,
};

type Props = Partial<TimelineModel> & {
  start: string;
  end: string;
  entityType: EntityType;
};

const TEST_PREFIX = 'security_solution:sessions_viewer:sessions_view';

const callFilters = jest.fn();

// creating a dummy component for testing TGrid to avoid mocking all the implementation details
// but still test if the TGrid will render properly
const SessionsViewerTGrid: React.FC<Props> = ({ columns, start, end, id, filters, entityType }) => {
  useEffect(() => {
    callFilters(filters);
  }, [filters]);

  return (
    <div>
      <div data-test-subj={`${TEST_PREFIX}:entityType`}>{entityType}</div>
      <div data-test-subj={`${TEST_PREFIX}:startDate`}>{start}</div>
      <div data-test-subj={`${TEST_PREFIX}:endDate`}>{end}</div>
      <div data-test-subj={`${TEST_PREFIX}:timelineId`}>{id}</div>
      {columns?.map((header) => (
        <div key={header.id}>{header.display ?? header.id}</div>
      ))}
    </div>
  );
};

jest.mock('@kbn/timelines-plugin/public/mock/plugin_mock', () => {
  const originalModule = jest.requireActual('@kbn/timelines-plugin/public/mock/plugin_mock');
  return {
    ...originalModule,
    createTGridMocks: () => ({
      ...originalModule.createTGridMocks,
      getTGrid: SessionsViewerTGrid,
    }),
  };
});

describe('SessionsView', () => {
  it('renders the session view', async () => {
    const wrapper = render(
      <TestProviders>
        <SessionsView {...testProps} />
      </TestProviders>
    );

    await waitFor(() => {
      expect(wrapper.queryByTestId(TEST_ID)).toBeInTheDocument();
    });
  });

  it('renders correctly against snapshot', async () => {
    const { asFragment } = render(
      <TestProviders>
        <SessionsView {...testProps} />
      </TestProviders>
    );

    await waitFor(() => {
      expect(asFragment()).toMatchSnapshot();
    });
  });

  it('passes in the right parameters to TGrid', async () => {
    const wrapper = render(
      <TestProviders>
        <SessionsView {...testProps} />
      </TestProviders>
    );
    await waitFor(() => {
      expect(wrapper.getByTestId(`${TEST_PREFIX}:entityType`)).toHaveTextContent('sessions');
      expect(wrapper.getByTestId(`${TEST_PREFIX}:startDate`)).toHaveTextContent(startDate);
      expect(wrapper.getByTestId(`${TEST_PREFIX}:endDate`)).toHaveTextContent(endDate);
      expect(wrapper.getByTestId(`${TEST_PREFIX}:timelineId`)).toHaveTextContent(
        'hosts-page-sessions-v2'
      );
    });
  });

  it('passes in the right filters to TGrid', async () => {
    render(
      <TestProviders>
        <SessionsView {...testProps} />
      </TestProviders>
    );
    await waitFor(() => {
      expect(callFilters).toHaveBeenCalledWith([
        {
          ...defaultSessionsFilter,
          query: {
            ...defaultSessionsFilter.query,
            bool: {
              ...defaultSessionsFilter.query.bool,
              filter: defaultSessionsFilter.query.bool.filter.concat(JSON.parse(filterQuery)),
            },
          },
        },
      ]);
    });
  });
});
