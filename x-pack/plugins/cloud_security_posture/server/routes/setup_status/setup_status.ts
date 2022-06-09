/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import { transformError } from '@kbn/securitysolution-es-utils';
import { ElasticsearchClient, SavedObjectsClientContract } from '@kbn/core/server';
import {
  AgentPolicyServiceInterface,
  AgentService,
  PackagePolicyServiceInterface,
  PackageService,
} from '@kbn/fleet-plugin/server';
import { ListResult, PackagePolicy } from '@kbn/fleet-plugin/common';
import {
  CLOUD_SECURITY_POSTURE_PACKAGE_NAME,
  INFO_ROUTE_PATH,
  LATEST_FINDINGS_INDEX_DEFAULT_NS,
} from '../../../common/constants';
import { CspAppContext } from '../../plugin';
import { CspRouter } from '../../types';
import { CspSetupStatus, LatestFindingsIndexState } from '../../../common/types';
import {
  addRunningAgentToAgentPolicy,
  getCspAgentPolicies,
  getCspPackagePolicies,
} from '../benchmarks/benchmarks';

const isFindingsExists = async (esClient: ElasticsearchClient): Promise<boolean> => {
  try {
    const queryResult = await esClient.search({
      index: LATEST_FINDINGS_INDEX_DEFAULT_NS,
      query: {
        match_all: {},
      },
      size: 1,
    });

    const hasLatestFinding = !!queryResult.hits.hits.length;

    return hasLatestFinding ? true : false;
  } catch (e) {
    return false;
  }
};

const isCspPackageInstalledOnAgentPolicy = async (
  soClient: SavedObjectsClientContract,
  packagePolicyService: PackagePolicyServiceInterface
): Promise<ListResult<PackagePolicy>> => {
  const cspPackagePolicies = getCspPackagePolicies(
    soClient,
    packagePolicyService,
    CLOUD_SECURITY_POSTURE_PACKAGE_NAME,
    { per_page: 10000 }
  );
  return cspPackagePolicies;
};

const getHealthyAgents = async (
  soClient: SavedObjectsClientContract,
  cspPackagePolicies: ListResult<PackagePolicy>,
  agentPolicyService: AgentPolicyServiceInterface,
  agentService: AgentService
): Promise<number> => {
  const agentPolicies = await getCspAgentPolicies(
    soClient,
    cspPackagePolicies.items,
    agentPolicyService
  );
  const enrichAgentPolicies = await addRunningAgentToAgentPolicy(agentService, agentPolicies);
  const totalAgents = enrichAgentPolicies
    .map((agentPolicy) => (agentPolicy.agents ? agentPolicy.agents : 0))
    .reduce((previousValue, currentValue) => previousValue + currentValue);
  return totalAgents;
};

const getInstalledPackageVersion = async (
  packageService: PackageService
): Promise<string | null> => {
  const packageInfo = await packageService.asInternalUser.getInstallation(
    CLOUD_SECURITY_POSTURE_PACKAGE_NAME
  );

  if (packageInfo) {
    // TODO: check version VS install_version
    console.log(packageInfo.install_version);
    return packageInfo.version;
  }
  return null;
};

const geLatestFindingsIndexStatus = async (
  esClient: ElasticsearchClient,
  installedPckVer: string | null,
  healthyAgents: number
): Promise<LatestFindingsIndexState> => {
  if (await isFindingsExists(esClient)) return 'indexed';

  if (installedPckVer == null) return 'not installed';

  if (healthyAgents > 0) return 'indexing';

  if (healthyAgents === 0) return 'not deployed';

  // todo: calc the real index timeout
  return 'index_timeout';
};

const getCspSetupStatus = async (
  esClient: ElasticsearchClient,
  soClient: SavedObjectsClientContract,
  packageService: PackageService,
  packagePolicyService: PackagePolicyServiceInterface,
  agentPolicyService: AgentPolicyServiceInterface,
  agentService: AgentService
): Promise<CspSetupStatus> => {
  const installedPckVer = await getInstalledPackageVersion(packageService);

  const cspPackageInstalled = await isCspPackageInstalledOnAgentPolicy(
    soClient,
    packagePolicyService
  );

  const installedIntegrations = cspPackageInstalled.items.length
    ? cspPackageInstalled.items.length
    : 0;

  const healthyAgents = await getHealthyAgents(
    soClient,
    cspPackageInstalled,
    agentPolicyService,
    agentService
  );

  const latestPkgVersion = await packageService.asInternalUser.fetchFindLatestPackage(
    CLOUD_SECURITY_POSTURE_PACKAGE_NAME
  );

  const status = await geLatestFindingsIndexStatus(esClient, installedPckVer, healthyAgents);
  return {
    status,
    latest_pkg_version: 'latestPkgVersion',
    installed_integration: installedIntegrations,
    healthy_agents: healthyAgents,
    installed_pkg_ver: installedPckVer,
  };
};

export const defineGetCspSetupStatusRoute = (router: CspRouter, cspContext: CspAppContext): void =>
  router.get(
    {
      path: INFO_ROUTE_PATH,
      validate: false,
    },
    async (context, _, response) => {
      try {
        const esClient = (await context.core).elasticsearch.client.asCurrentUser;
        const soClient = (await context.core).savedObjects.client;

        const packageService = cspContext.service.packageService;
        const agentService = cspContext.service.agentService;
        const agentPolicyService = cspContext.service.agentPolicyService;
        const packagePolicyService = cspContext.service.packagePolicyService;

        if (!agentPolicyService || !agentService || !packagePolicyService || !packageService) {
          throw new Error(`Failed to get Fleet services`);
        }

        const status = await getCspSetupStatus(
          esClient,
          soClient,
          packageService,
          packagePolicyService,
          agentPolicyService,
          agentService
        );

        const body: CspSetupStatus = status;

        return response.ok({
          body,
        });
      } catch (err) {
        const error = transformError(err);
        cspContext.logger.error(`Error while fetching findings status: ${err}`);

        return response.customError({
          body: { message: error.message },
          statusCode: error.statusCode,
        });
      }
    }
  );
