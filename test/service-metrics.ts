import { expect } from 'chai';
import { describe, it } from 'mocha';
import { stub } from 'sinon';
import hookServersStartStop from './helpers/servers';
import { hookServices } from './helpers/stub-service';
import { hookServiceMetrics } from './helpers/service-metrics';
import env from '../app/util/env';
import hookDescribeImage from './helpers/container-registry';

describe('service/metrics endpoint', function () {
  hookServersStartStop({ skipEarthdataLogin: true });
  describe('when using the services from services.yml', function () {
    describe('when hitting the service/metrics endpoint without serviceID parameter', function () {
      hookServiceMetrics();

      it('returns a 400 success', function () {
        expect(this.res.statusCode).to.equal(400);
      });

      it('returns a JSON response', function () {
        expect(this.res.get('Content-Type')).to.equal('text/html; charset=utf-8');
      });

    });
  });

});