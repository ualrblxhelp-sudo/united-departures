// config/ids.js
// All Discord IDs loaded from environment variables

module.exports = {
    STAFF_SERVER_ID: process.env.STAFF_SERVER_ID,
    CALENDAR_SERVER_ID: process.env.CALENDAR_SERVER_ID,
    FORUM_CHANNEL_ID: process.env.FORUM_CHANNEL_ID,
    CMDS_CHANNEL_ID: process.env.CMDS_CHANNEL_ID,
    CALENDAR_CHANNEL_ID: process.env.CALENDAR_CHANNEL_ID,
    ARCHIVE_CHANNEL_ID: process.env.ARCHIVE_CHANNEL_ID,
    FLIGHT_HOST_ROLE_ID: process.env.FLIGHT_HOST_ROLE_ID,
    UNITED_TAIL_EMOJI: process.env.UNITED_TAIL_EMOJI || '✈️',
    EMBED_COLOR: parseInt(process.env.EMBED_COLOR || '2596be', 16),
};
