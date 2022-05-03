import { describe, before } from 'mocha';
import { expect, assert } from 'chai';
import Web3 from 'web3';

import { logger } from '../src/utils/logger';
import VerilayClient from '../src/index';

describe('Deploy and update relay from historic state', () => {
    const targetUrl = 'http://localhost:8555';
    const sourceUrl = 'http://localhost:9596';
    let syncCommitteePeriod = 1;
    let verilayClient: VerilayClient;

    before(async () => {
        logger.setSettings({ minLevel: 'info', name: 'client test setup' });

        const web3 = new Web3(targetUrl);
        const [account] = await web3.eth.getAccounts();
        expect(account).to.exist;
        verilayClient = new VerilayClient(targetUrl, sourceUrl, account);
    });

    it('should deploy the relay contract', async () => {
        logger.setSettings({ minLevel: 'info', name: 'deploy relay contract' });

        const relayContractAddress = await verilayClient.deployContractAtPeriod(
            syncCommitteePeriod++,
            170,
            0,
        );
        expect(relayContractAddress).to.exist;
    });

    const updateRelayContract = (i: number) => {
        it(`should update relay contract with new sync committee period, ${i}. iteration`, async () => {
            logger.setSettings({ minLevel: 'info', name: `update relay, ${i} iteration` });

            const txHash = await verilayClient.updateSyncCommittee(syncCommitteePeriod++);
            expect(txHash).to.exist;
            logger.info(`${i}. update txHash: ${txHash}`);
        });
    };

    describe('multiple updates', () => {
        for (let i = 1; i <= 3; i++) {
            updateRelayContract(i);
        }

        it('should reject update skipping subsequent period', async () => {
            logger.setSettings({ minLevel: 'info', name: 'reject update' });

            return verilayClient.updateSyncCommittee(syncCommitteePeriod + 1)
                .then((txHash) => {
                    assert.fail(`transaction should fail, but was okay at tx: ${txHash}`);
                }).catch((err: Error) => {
                    expect(err.message).to.have.string('merkle proof for next sync committee not valid');
                    logger.info(`transaction failed as expected: ${err.message}`);
                });
        });
    });
});
