/**
 * Required dependencies
 */
const opensubtitles = require("./opensubtitles");
const connection = require("./connection");
const fs = require("fs").promises;
const { translateText } = require("./translateProvider");
const {
  createOrUpdateMessageSub,
  generateSubtitlePath,
} = require("./subtitles");

class SubtitleProcessor {
  constructor() {
    this.subcounts = [];
    this.timecodes = [];
    this.texts = [];
    this.translatedSubtitle = [];
    this.count = 0;
  }

  async processSubtitles(
    filepath,
    imdbid,
    season = null,
    episode = null,
    oldisocode,
    provider,
    apikey,
    base_url,
    model_name,
    batch_size
  ) {
    try {
      const originalSubtitleFilePath = filepath[0];
      const originalSubtitleContent = await fs.readFile(
        originalSubtitleFilePath,
        { encoding: "utf-8" }
      );
      const lines = originalSubtitleContent.split("\n");

      const batchSize = batch_size;
      let subtitleBatch = [];
      let currentBlock = {
        iscount: true,
        istimecode: false,
        istext: false,
        textcount: 0,
      };

      // Process subtitle file line by line
      for (const line of lines) {
        if (line.trim() === "") {
          currentBlock = {
            iscount: true,
            istimecode: false,
            istext: false,
            textcount: 0,
          };

          if (this.texts.length > 0) {
            subtitleBatch.push(this.texts[this.texts.length - 1]);
          }

          // Translate when batch size is reached
          if (subtitleBatch.length === batchSize) {
            try {
              await this.translateBatch(
                subtitleBatch,
                oldisocode,
                provider,
                apikey,
                base_url,
                model_name,
                imdbid,
                season,
                episode
              );
              subtitleBatch = [];
            } catch (error) {
              console.error("Batch translation error: ", error.message);
              throw error;
            }
          }
          continue;
        }

        if (currentBlock.iscount) {
          this.subcounts.push(line);
          currentBlock = {
            iscount: false,
            istimecode: true,
            istext: false,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.istimecode) {
          this.timecodes.push(line);
          currentBlock = {
            iscount: false,
            istimecode: false,
            istext: true,
            textcount: 0,
          };
          continue;
        }

        if (currentBlock.istext) {
          if (currentBlock.textcount === 0) {
            this.texts.push(line);
          } else {
            this.texts[this.texts.length - 1] += "\n" + line;
          }
          currentBlock.textcount++;
        }
      }

      // Process remaining batch
      if (subtitleBatch.length > 0) {
        try {
          subtitleBatch.push(this.texts[this.texts.length - 1]);
          await this.translateBatch(
            subtitleBatch,
            oldisocode,
            provider,
            apikey,
            base_url,
            model_name,
            imdbid,
            season,
            episode
          );
        } catch (error) {
          console.log("Subtitle batch error: ", error.message);
          throw error;
        }
      }

      // Save translated subtitles
      try {
        await this.saveTranslatedSubs(
          imdbid,
          season,
          episode,
          oldisocode,
          provider
        );
        console.log("Subtitles saved successfully");
      } catch (error) {
        console.error("Error saving translated subtitles:", error);
        throw error;
      }
    } catch (error) {
      console.error("Error:", error.message);
      throw error;
    }
  }

  async translateBatch(
    subtitleBatch,
    oldisocode,
    provider,
    apikey,
    base_url,
    model_name,
    imdbid,
    season,
    episode
  ) {
    try {
      const translations = await translateText(
        subtitleBatch,
        oldisocode,
        provider,
        apikey,
        base_url,
        model_name
      );

      translations.forEach((translatedText) => {
        this.translatedSubtitle.push(translatedText);
      });

      console.log("Batch translation completed");
    } catch (error) {
      console.error("Batch translation error:", error.message);
      
      // Create error message subtitle for user
      let errorMsg = "Translation failed. ";
      if (error.message.includes("Insufficient Balance")) {
        errorMsg += "API account has insufficient balance. Please top up your account.";
      } else if (error.message.includes("invalid_api_key") || error.message.includes("unauthorized")) {
        errorMsg += "Invalid API key. Please check your configuration.";
      } else if (error.message.includes("quota_exceeded")) {
        errorMsg += "API quota exceeded. Please wait or upgrade your plan.";
      } else {
        errorMsg += error.message;
      }
      
      // Update subtitle with error message
      await createOrUpdateMessageSub(
        errorMsg,
        imdbid,
        season,
        episode,
        oldisocode,
        provider
      );
      
      throw error;
    }
  }

  async saveTranslatedSubs(
    imdbid,
    season = null,
    episode = null,
    oldisocode,
    provider
  ) {
    try {
      // Define directory path based on content type and provider
      const newSubtitleFilePath = generateSubtitlePath(
        provider,
        oldisocode,
        imdbid,
        season,
        episode
      );
      const dirPath = newSubtitleFilePath.substring(
        0,
        newSubtitleFilePath.lastIndexOf("/")
      );

      // Create directory if it doesn't exist
      await fs.mkdir(dirPath, { recursive: true });

      // Determine content type
      const type = season && episode ? "series" : "movie";

      // Build subtitle content
      const output = [];
      for (let i = 0; i < this.subcounts.length; i++) {
        output.push(
          this.subcounts[i],
          this.timecodes[i],
          this.translatedSubtitle[i],
          ""
        );
      }

      // Save file and update database
      await fs.writeFile(newSubtitleFilePath, output.join("\n"), { flag: "w" });

      if (!(await connection.checkseries(imdbid))) {
        await connection.addseries(imdbid, type);
      }

      console.log(
        `Subtitle translation and saving completed: ${newSubtitleFilePath}`
      );
    } catch (error) {
      console.error("Error saving translated subtitles:", error);
      throw error;
    }
  }
}

/**
 * Starts the subtitle translation process
 * @param {Object[]} subtitles - Array of subtitle objects to translate
 * @param {string} imdbid - IMDB ID of the media
 * @param {string|null} season - Season number (optional)
 * @param {string|null} episode - Episode number (optional)
 * @param {string} oldisocode - ISO code of the original language
 * @returns {Promise<boolean>} - Returns true on success, false otherwise
 */
async function startTranslation(
  subtitles,
  imdbid,
  season = null,
  episode = null,
  oldisocode,
  provider,
  apikey,
  base_url,
  model_name,
  batch_size
) {
  let filepaths = [];
  try {
    const processor = new SubtitleProcessor();
    filepaths = await opensubtitles.downloadSubtitles(
      subtitles,
      imdbid,
      season,
      episode,
      oldisocode
    );

    if (filepaths && filepaths.length > 0) {
      await connection.addToTranslationQueue(
        imdbid,
        season,
        episode,
        filepaths.length,
        oldisocode,
        provider,
        apikey
      );
      await processor.processSubtitles(
        filepaths,
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
      return true;
    }
    return false;
  } catch (error) {
    console.error("General catch error:", error.message);
    
    // Create user-friendly error message
    let userMessage = "Translation failed. ";
    if (error.message.includes("Insufficient Balance")) {
      userMessage += "DeepSeek API account has insufficient balance. Please top up at https://platform.deepseek.com";
    } else if (error.message.includes("invalid_api_key") || error.message.includes("unauthorized")) {
      userMessage += "Invalid API key. Please check your addon configuration.";
    } else if (error.message.includes("quota_exceeded")) {
      userMessage += "API quota exceeded. Please wait or upgrade your plan.";
    } else if (error.message.includes("rate_limit")) {
      userMessage += "Rate limit exceeded. Please wait a moment and try again.";
    } else {
      userMessage += "Please check your configuration and try again.";
    }
    
    // Update subtitle with error message
    try {
      await createOrUpdateMessageSub(
        userMessage,
        imdbid,
        season,
        episode,
        oldisocode,
        provider
      );
    } catch (msgError) {
      console.error("Error creating error message subtitle:", msgError);
    }
    
    return false;
  } finally {
    // Cleanup: Delete downloaded original subtitle files
    for (const fp of filepaths) {
      try {
        await fs.unlink(fp);
        console.log(`Cleaned up downloaded file: ${fp}`);
      } catch (unlinkError) {
        console.error(`Error cleaning up file ${fp}:`, unlinkError);
      }
    }
    // Cleanup: Delete entry from translation queue in DB
    try {
      await connection.deletetranslationQueue(
        imdbid,
        season,
        episode,
        oldisocode
      );
      console.log("Cleaned up translation queue entry in DB.");
    } catch (dbCleanupError) {
      console.error("Error cleaning up DB translation queue entry:", dbCleanupError);
    }
  }
}

module.exports = { startTranslation };
