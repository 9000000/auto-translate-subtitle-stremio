const Queue = require("better-queue");
const processfiles = require("../processfiles");

const translationQueue = new Queue(
  async function (job, cb) {
    try {
      const {
        subs,
        imdbid,
        season,
        episode,
        oldisocode,
        provider,
        apikey,
        base_url,
        model_name,
        batch_size,
      } = job;

      console.log("Processing subtitles:", subs);

      // Keep as is
      const result = await processfiles.startTranslation(
        subs,
        imdbid,
        season,
        episode,
        oldisocode,
        provider,
        apikey,
        base_url,
        model_name,
        batch_size
      );

      cb(null, result);
    } catch (error) {
      console.error("Queue error:", error);
      cb(error);
    }
  },
  {
    concurrent: 1, // Reduce to 1 process initially
    maxRetries: 3,
    retryDelay: 3000,
  }
);

module.exports = translationQueue;
