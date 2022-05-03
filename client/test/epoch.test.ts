import { describe, before } from 'mocha';
import { expect } from 'chai';
import Web3 from 'web3';

import { logger } from '../src/utils/logger';
import BeaconChainClient from '../src/beaconChainClient';
import VerilayClient from '../src';

const EPOCHS_PER_SYNC_COMMITTEE_PERIOD = 256;
const ALTAIR_EPOCH = 74240;

describe('Deploy and update relay from historic state', () => {
    const targetUrl = 'http://localhost:8555';
    const sourceUrl = 'http://localhost:9596';
    let syncCommitteePeriod = -1;
    let targetEpoch = -1;
    let relayContractAddress: string;
    let verilayClient: VerilayClient;

    const setup = new Promise<boolean>((resolve) => {
        logger.setSettings({ minLevel: 'info', name: 'client test setup' });

        const web3 = new Web3(targetUrl);
        const beaconChainClient = new BeaconChainClient(sourceUrl);

        beaconChainClient.getLatestSyncCommitteePeriod().then((_syncCommitteePeriod) => {
            syncCommitteePeriod = _syncCommitteePeriod;
            targetEpoch = (EPOCHS_PER_SYNC_COMMITTEE_PERIOD * syncCommitteePeriod) + ALTAIR_EPOCH + 1;
            logger.info('syncPeriod: ', syncCommitteePeriod, ', targetEpoch: ', targetEpoch);
            return web3.eth.getAccounts();
        }).then((accounts) => {
            const [account] = accounts;
            expect(account).to.exist;
            verilayClient = new VerilayClient(targetUrl, sourceUrl, account);
            resolve(true);
        });
    });

    before(async () => {
        await setup;
    });

    it('should deploy the relay contract', async () => {
        logger.setSettings({ minLevel: 'info', name: 'deploy relay contract' });

        relayContractAddress = await verilayClient.deployContractAtPeriod(syncCommitteePeriod, 170, 0);
        expect(relayContractAddress).to.exist;
    });

    const updateRelayContract = (_epoch: number) => {
        it(`should update relay contract with epoch ${_epoch}`, async () => {
            logger.setSettings({ minLevel: 'info', name: `update relay, epoch ${_epoch}` });

            const txHash = await verilayClient.updateEpoch(_epoch);
            expect(txHash).to.exist;
            logger.info(`epoch ${_epoch} updateed, txHash: ${txHash}`);
        });
    };

    (async () => {
        // before would only be executed before it and not describe
        // therefore, a setup function is used that is waited for
        await setup;
        describe('multiple updates', () => {
            for (let i = 1; i <= 1; i++) {
                updateRelayContract(targetEpoch++);
            }
        });
    })();
});
