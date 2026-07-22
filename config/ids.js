module.exports = {
    STAFF_SERVER_ID: process.env.STAFF_SERVER_ID,
    CALENDAR_SERVER_ID: process.env.CALENDAR_SERVER_ID,
    FORUM_CHANNEL_ID: process.env.FORUM_CHANNEL_ID,
    CMDS_CHANNEL_ID: process.env.CMDS_CHANNEL_ID,
    CALENDAR_CHANNEL_ID: process.env.CALENDAR_CHANNEL_ID,
    ARCHIVE_CHANNEL_ID: process.env.ARCHIVE_CHANNEL_ID,
    FLIGHT_HOST_ROLE_ID: process.env.FLIGHT_HOST_ROLE_ID,
    UNITED_TAIL_EMOJI: process.env.UNITED_TAIL_EMOJI || '\u2708\uFE0F',
    EMBED_COLOR: parseInt(process.env.EMBED_COLOR || '0b0fa8', 16),
    // Volare (staff) flight calendar. Allocation sheets are now threads spawned
    // off a reposted calendar message in THIS channel (the forum is retired).
    STAFF_CALENDAR_CHANNEL_ID: process.env.STAFF_CALENDAR_CHANNEL_ID || '1309566352662462579',
    PREMIUM_CALENDAR_CHANNEL_ID: process.env.PREMIUM_CALENDAR_CHANNEL_ID,
    // Channel (main server) where public flight announcements are posted.
    FLIGHT_ANNOUNCE_CHANNEL_ID: process.env.FLIGHT_ANNOUNCE_CHANNEL_ID || '1309648814533115954',
    // Volare (staff) briefing channel for crew callouts before departure.
    BRIEFING_CHANNEL_ID: process.env.BRIEFING_CHANNEL_ID || '1528984319614259363',
    // Permanent Roblox hub link used in Discord scheduled events and panel announcements.
    AIRPORT_LINK: process.env.AIRPORT_LINK || 'https://www.roblox.com/games/76822570410442/UAL-Hub',
    // Volare (staff) channel where flight attendance embeds are posted at payout.
    // NOTE: a Render env var of the same name OVERRIDES this default. If embeds
    // land in the wrong channel, check Render's environment first.
    ATTENDANCE_CHANNEL_ID: process.env.ATTENDANCE_CHANNEL_ID || '1528980853336572085',
    // Minimum Roblox group rank counted as "on duty" for attendance.
    ATTENDANCE_MIN_RANK: parseInt(process.env.ATTENDANCE_MIN_RANK || '50', 10),
};
