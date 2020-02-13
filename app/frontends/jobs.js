const pick = require('lodash.pick');
const Job = require('../models/job');
const db = require('../util/db');
const isUUID = require('../util/uuid');

const serializedJobFields = [
  'requestId', 'username', 'status', 'message', 'progress', 'createdAt', 'updatedAt', 'links'];

/**
 * Serializes a Job to return from job listing and status endpoints
 * @param {Job} job the job
 * @returns {Object} an object with the serialized job fields.
 */
function _serializeJob(job) {
  const serializedJob = pick(job, serializedJobFields);
  serializedJob.updatedAt = new Date(serializedJob.updatedAt);
  serializedJob.createdAt = new Date(serializedJob.createdAt);
  return serializedJob;
}

/**
 * Express.js handler that handles the jobs listing endpoint (/jobs)
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobsListing(req, res) {
  req.logger.info(`Get job listing for user ${req.user}`);
  const listing = await Job.forUser(db, req.user);
  res.send(listing.map((j) => _serializeJob(j)));
}

/**
 * Express.js handler that returns job status for a single job (/jobs/{jobId})
 *
 * @param {http.IncomingMessage} req The request sent by the client
 * @param {http.ServerResponse} res The response to send to the client
 * @returns {Promise<void>} Resolves when the request is complete
 */
async function getJobStatus(req, res) {
  const { jobId } = req.params;
  req.logger.info(`Get job status for job ${jobId} and user ${req.user}`);
  if (!isUUID(jobId)) {
    res.status(400);
    res.json({
      code: 'harmony:BadRequestError',
      description: `Error: jobId ${jobId} is in invalid format.` });
  } else {
    const job = await Job.byUsernameAndRequestId(db, req.user, jobId);
    if (job) {
      res.send(_serializeJob(job));
    } else {
      res.status(404);
      res.json({ code: 'harmony:NotFoundError', description: `Error: Unable to find job ${jobId}` });
    }
  }
}

module.exports = { getJobsListing, getJobStatus };
