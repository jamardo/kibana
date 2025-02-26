/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { render } from '@testing-library/react';
import React from 'react';
import { SecurityPageName } from '../../app/types';
import type { NavLinkItem } from '../../common/components/navigation/types';
import { TestProviders } from '../../common/mock';
import { LandingLinksImages } from './landing_links_images';

const DEFAULT_NAV_ITEM: NavLinkItem = {
  id: SecurityPageName.overview,
  title: 'TEST LABEL',
  description: 'TEST DESCRIPTION',
  image: 'TEST_IMAGE.png',
};

jest.mock('../../common/lib/kibana/kibana_react', () => {
  return {
    useKibana: jest.fn().mockReturnValue({
      services: {
        application: {
          getUrlForApp: jest.fn(),
        },
      },
    }),
  };
});

describe('LandingLinksImages', () => {
  it('renders', () => {
    const title = 'test label';

    const { queryByText } = render(
      <TestProviders>
        <LandingLinksImages items={[{ ...DEFAULT_NAV_ITEM, title }]} />
      </TestProviders>
    );

    expect(queryByText(title)).toBeInTheDocument();
  });

  it('renders image', () => {
    const image = 'test_image.jpeg';
    const title = 'TEST_LABEL';

    const { getByTestId } = render(
      <TestProviders>
        <LandingLinksImages items={[{ ...DEFAULT_NAV_ITEM, image, title }]} />
      </TestProviders>
    );

    expect(getByTestId('LandingLinksImage')).toHaveAttribute('src', image);
  });
});
