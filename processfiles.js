/**
 * Required dependencies
 */
const opensubtitles = require("./opensubtitles");
const connection = require("./connection");
const fs = require('fs').promises;
const { translateText } = require('./translateProvider');
const { createOrUpdateMessageSub } = require('./subtitles');

class SubtitleProcessor {
    constructor() {
        this.subcounts = [];
        this.timecodes = [];
        this.texts = [];
        this.translatedSubtitle = [];
        this.count = 0;
    }

    async processSubtitles(filepath, imdbid, season = null, episode = null, oldisocode, provider, apikey) {
        try {
            const originalSubtitleFilePath = filepath[0];
            const originalSubtitleContent = await fs.readFile(originalSubtitleFilePath, { encoding: 'utf-8' });
            const lines = originalSubtitleContent.split('\n');

            const batchSize = provider === "chatgpt" ? 200 : 60;
            let subtitleBatch = [];
            let currentBlock = {
                iscount: true,
                istimecode: false,
                istext: false,
                textcount: 0
            };

            // Process subtitle file line by line
            for (const line of lines) {
                if (line.trim() === '') {
                    currentBlock = {
                        iscount: true,
                        istimecode: false,
                        istext: false,
                        textcount: 0
                    };

                    if (this.texts.length > 0) {
                        subtitleBatch.push(this.texts[this.texts.length - 1]);
                    }

                    // Translate when batch size is reached
                    if (subtitleBatch.length === batchSize) {
                        try {
                            await this.translateBatch(subtitleBatch, oldisocode, provider, apikey);
                            subtitleBatch = [];
                        } catch (error) {
                            console.error("Translate batch error: ", error);
                            throw error;
                        }
                    }
                    continue;
                }

                if (currentBlock.iscount) {
                    this.subcounts.push(line);
                    currentBlock = { iscount: false, istimecode: true, istext: false, textcount: 0 };
                    continue;
                }

                if (currentBlock.istimecode) {
                    this.timecodes.push(line);
                    currentBlock = { iscount: false, istimecode: false, istext: true, textcount: 0 };
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
                    await this.translateBatch(subtitleBatch, oldisocode, provider, apikey);
                } catch (error) {
                    console.log("Subtitle batch error: ", error);
                    throw error;
                }
            }

            // Save translated subtitle
            try {
                await this.saveTranslatedSubs(imdbid, season, episode, oldisocode, provider);
                console.log("Subtitle saved successfully");
            } catch (error) {
                console.error("Save translation error: ", error);
                throw error;
            }

        } catch (error) {
            console.error('Error:', error.message);
            throw error;
        }
    }

    async translateBatch(subtitleBatch, oldisocode, provider, apikey) {
        try {

            const translations = await translateText(subtitleBatch, oldisocode, provider, apikey);

            translations.forEach(translatedText => {
                this.translatedSubtitle.push(translatedText);
            });

            console.log("Batch translated");
        } catch (error) {
            console.error("Batch translate error:", error);
            throw error;
        }
    }

    async saveTranslatedSubs(imdbid, season = null, episode = null, oldisocode, provider) {
        try {
            // Define directory path based on content type and provider
            const dirPath = season !== null && episode !== null
                ? `subtitles/${provider}/${oldisocode}/${imdbid}/season${season}`
                : `subtitles/${provider}/${oldisocode}/${imdbid}`;

            // Create directory if it doesn't exist
            await fs.mkdir(dirPath, { recursive: true });

            // Build file path and determine content type
            const type = season && episode ? 'series' : 'movie';
            const newSubtitleFilePath = season && episode
                ? `${dirPath}/${imdbid}-translated-${episode}-1.srt`
                : `${dirPath}/${imdbid}-translated-1.srt`;

            // Build subtitle content
            const output = [];
            for (let i = 0; i < this.subcounts.length; i++) {
                output.push(this.subcounts[i], this.timecodes[i], this.translatedSubtitle[i], '');
            }

            // Save file and update database
            await fs.writeFile(newSubtitleFilePath, output.join('\n'), { flag: 'w' });

            if (!(await connection.checkseries(imdbid))) {
                await connection.addseries(imdbid, type);
            }

            console.log(`Subtitles translated and saved: ${newSubtitleFilePath}`);
        } catch (error) {
            console.error('Error saving translated subtitles:', error);
            throw error;
        }
    }
}

/**
 * Initiates the subtitle translation process
 * @param {Object[]} subtitles - Array of subtitle objects to be translated
 * @param {string} imdbid - IMDB ID of the media
 * @param {string|null} season - Season number (optional)
 * @param {string|null} episode - Episode number (optional)
 * @param {string} oldisocode - Original language ISO code
 * @returns {Promise<boolean>} - Returns true if successful, false otherwise
 */
async function startTranslation(subtitles, imdbid, season = null, episode = null, oldisocode, provider, apikey) {
    try {
        const processor = new SubtitleProcessor();
        let filepaths = await opensubtitles.downloadSubtitles(subtitles, imdbid, season, episode, oldisocode);

        if (filepaths && filepaths.length > 0) {
            await connection.addToTranslationQueue(imdbid, season, episode, filepaths.length, oldisocode, provider, apikey);
            await processor.processSubtitles(filepaths, imdbid, season, episode, oldisocode, provider, apikey);
            await connection.deletetranslationQueue(imdbid, season, episode, oldisocode);
            return true;
        }
        return false;
    } catch (error) {
        console.error("General catch error:", error);
        return false;
    }
}

module.exports = { startTranslation };
