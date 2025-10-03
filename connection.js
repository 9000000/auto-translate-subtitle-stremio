const DatabaseFactory = require('./database/DatabaseFactory');

let dbAdapter = null;

// Initialize database connection
async function initializeDatabase() {
    if (!dbAdapter) {
        try {
            dbAdapter = await DatabaseFactory.createAndConnect();
            console.log('Database initialized successfully!');
        } catch (error) {
            console.error('Database initialization error:', error);
            // Re-throw the error so it can be handled by the caller.
            throw error;
        }
    }
    return dbAdapter;
}

// Get adapter instance
async function getAdapter() {
    if (!dbAdapter) {
        await initializeDatabase();
    }
    return dbAdapter;
}

// Utility methods for backward API compatibility
async function addToTranslationQueue(imdbid, season = null, episode = null, count, langcode) {
    const adapter = await getAdapter();
    return adapter.addToTranslationQueue(imdbid, season, episode, count, langcode);
}

async function deletetranslationQueue(imdbid, season = null, episode = null, langcode) {
    const adapter = await getAdapter();
    return adapter.deletetranslationQueue(imdbid, season, episode, langcode);
}

async function checkForTranslation(imdbid, season = null, episode = null, langcode) {
    const adapter = await getAdapter();
    return adapter.checkForTranslation(imdbid, season, episode, langcode);
}

async function checkseries(imdbid) {
    const adapter = await getAdapter();
    return adapter.checkseries(imdbid);
}

async function addseries(imdbid, type) {
    const adapter = await getAdapter();
    return adapter.addseries(imdbid, type);
}

async function getSubCount(imdbid, season, episode, langcode) {
    const adapter = await getAdapter();
    return adapter.getSubCount(imdbid, season, episode, langcode);
}

async function addsubtitle(imdbid, type, season = null, episode = null, path, langcode) {
    const adapter = await getAdapter();
    return adapter.addsubtitle(imdbid, type, season, episode, path, langcode);
}

async function getsubtitles(imdbid, season = null, episode = null, langcode) {
    const adapter = await getAdapter();
    return adapter.getsubtitles(imdbid, season, episode, langcode);
}

async function checksubtitle(imdbid, season = null, episode = null, subtitlepath, langcode) {
    const adapter = await getAdapter();
    return adapter.checksubtitle(imdbid, season, episode, subtitlepath, langcode);
}

// Function to close the connection
async function closeConnection() {
    if (dbAdapter) {
        await dbAdapter.disconnect();
        dbAdapter = null;
    }
}

// Try to connect to the DB on startup, but don't crash the addon if it fails.
// The addon will then try to connect again on the first request that needs a DB.
(async () => {
    try {
        await initializeDatabase();
    } catch (e) {
        console.warn('Database connection failed on startup. Will retry on first request.', e.message);
    }
})();

module.exports = {
    addToTranslationQueue,
    deletetranslationQueue,
    getSubCount,
    checkseries,
    addseries,
    addsubtitle,
    getsubtitles,
    checkForTranslation,
    checksubtitle,
    closeConnection,
    getAdapter
};