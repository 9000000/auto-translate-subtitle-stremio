const mysql = require("mysql2");
const util = require("util");
const BaseAdapter = require("./BaseAdapter");

class MySQLAdapter extends BaseAdapter {
  constructor(config) {
    super(config);
    this.connection = null;
    this.query = null;
    this.reconnectInterval = null;
  }

  async connect() {
    try {
      this.connection = mysql.createConnection({
        host: this.config.host,
        user: this.config.user,
        password: this.config.password,
        database: this.config.database,
      });

      await new Promise((resolve, reject) => {
        this.connection.connect((err) => {
          if (err) {
            console.error("Error connecting to MySQL:", err);
            reject(err);
          } else {
            console.log("Connected to MySQL!");
            resolve();
          }
        });
      });

      this.query = util.promisify(this.connection.query).bind(this.connection);

      // Set up auto-reconnection
      this._setupReconnection();

      return true;
    } catch (error) {
      console.error("MySQL connection failed:", error.message);
      throw error;
    }
  }

  async disconnect() {
    if (this.reconnectInterval) {
      clearInterval(this.reconnectInterval);
    }

    if (this.connection) {
      this.connection.end();
      this.connection = null;
    }
  }

  _setupReconnection() {
    this.reconnectInterval = setInterval(() => {
      if (this.connection.state === "disconnected") {
        this.connection.connect((err) => {
          if (err) {
            console.error("MySQL reconnection error:", err);
          } else {
            console.log("Reconnected to MySQL!");
          }
        });
      }
    }, 60000);
  }

  async addToTranslationQueue(
    imdbid,
    season = null,
    episode = null,
    count,
    langcode
  ) {
    try {
      if (season && episode) {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,series_seasonno,series_episodeno,subcount,langcode) VALUES (?,?,?,?,?)",
          [imdbid, season, episode, count, langcode]
        );
      } else {
        await this.query(
          "INSERT INTO translation_queue (series_imdbid,subcount,langcode) VALUES (?,?,?)",
          [imdbid, count, langcode]
        );
      }
    } catch (error) {
      console.error("Error adding to translation queue:", error.message);
      throw error;
    }
  }

  async deletetranslationQueue(
    imdbid,
    season = null,
    episode = null,
    langcode
  ) {
    try {
      if (season && episode) {
        await this.query(
          "DELETE FROM translation_queue WHERE series_imdbid = ? AND series_seasonno = ? AND series_episodeno = ? AND langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        await this.query(
          "DELETE FROM translation_queue WHERE series_imdbid = ? AND langcode = ?",
          [imdbid, langcode]
        );
      }
    } catch (error) {
      console.error("Error deleting from translation queue:", error.message);
      throw error;
    }
  }

  async checkForTranslation(imdbid, season = null, episode = null, langcode) {
    try {
      let querySql = "SELECT COUNT(*) AS count, subcount FROM translation_queue WHERE series_imdbid = ? AND langcode = ?";
      const params = [imdbid, langcode];

      if (season !== null && episode !== null) {
        querySql += " AND series_seasonno = ? AND series_episodeno = ?";
        params.push(season, episode);
      } else {
        querySql += " AND series_seasonno IS NULL AND series_episodeno IS NULL";
      }

      console.log("Executing checkForTranslation query (MySQL):", querySql, params);
      const result = await this.query(querySql, params);

      if (!result || result.length === 0) {
        console.log("No translation queue entry found (MySQL).");
        return false;
      }

      const count = result[0].count;
      const subcount = result[0].subcount;

      console.log(`Translation check for ${imdbid} S${season}E${episode} [${langcode}] (MySQL): Found ${count} entries, subcount: ${subcount}`);

      if (count > 0) {
        return subcount;
      } else {
        return false;
      }
    } catch (error) {
      console.error("Translation check error (MySQL):", error.message);
      return false; // Ensure false is returned on error
    }
  }

  async checkseries(imdbid) {
    try {
      const result = await this.query(
        "SELECT COUNT(*) AS count FROM series WHERE series_imdbid = ?",
        [imdbid]
      );
      const count = result[0].count;

      return count > 0;
    } catch (error) {
      console.error("Series check error:", error);
      return false;
    }
  }

  async addseries(imdbid, type) {
    try {
      let seriestype = type === "series" ? 0 : 1;
      await this.query(
        "INSERT INTO series(series_imdbid,series_type) VALUES (?,?)",
        [imdbid, seriestype]
      );
    } catch (error) {
      console.error("Series add error:", error);
    }
  }

  async getSubCount(imdbid, season, episode, langcode) {
    try {
      let result;
      if (season && episode) {
        result = await this.query(
          "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        result = await this.query(
          "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_langcode = ?",
          [imdbid, langcode]
        );
      }
      return result[0].count;
    } catch (error) {
      console.error("Subtitle count error:", error.message);
      return 0;
    }
  }

  async addsubtitle(
    imdbid,
    type,
    season = null,
    episode = null,
    path,
    langcode
  ) {
    try {
      let seriestype = type === "series" ? 0 : 1;
      await this.query(
        "INSERT INTO subtitle(series_imdbid,subtitle_type,subtitle_seasonno,subtitle_episodeno,subtitle_langcode,subtitle_path) VALUES (?,?,?,?,?,?)",
        [imdbid, seriestype, season, episode, langcode, path]
      );
    } catch (error) {
      console.error("Subtitle add error:", error);
    }
  }

  async getsubtitles(imdbid, season = null, episode = null, langcode) {
    try {
      let rows;
      if (episode && season) {
        rows = await this.query(
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_langcode = ?",
          [imdbid, season, episode, langcode]
        );
      } else {
        rows = await this.query(
          "SELECT subtitle_path FROM subtitle WHERE series_imdbid = ? AND subtitle_langcode = ?",
          [imdbid, langcode]
        );
      }
      const paths = rows.map((row) => row.subtitle_path);
      return paths;
    } catch (error) {
      console.error("Subtitle retrieval error:", error.message);
      return [];
    }
  }

  async checksubtitle(
    imdbid,
    season = null,
    episode = null,
    subtitlepath,
    langcode
  ) {
    try {
      const result = await this.query(
        "SELECT COUNT(*) AS count FROM subtitle WHERE series_imdbid = ? AND subtitle_seasonno = ? AND subtitle_episodeno = ? AND subtitle_path = ? AND subtitle_langcode = ?",
        [imdbid, season, episode, subtitlepath, langcode]
      );
      const count = result[0].count;

      return count > 0;
    } catch (error) {
      console.error("Subtitle check error:", error);
      return false;
    }
  }
}

module.exports = MySQLAdapter;
