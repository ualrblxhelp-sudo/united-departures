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
    // United Aviate training server.
    AVIATE_SERVER_ID: process.env.AVIATE_SERVER_ID || '1309619225828266086',
    TRAINING_LOG_CHANNEL_ID: process.env.TRAINING_LOG_CHANNEL_ID || '1528186069407895572',
    TRAINING_STAFF_ROLE_ID: process.env.TRAINING_STAFF_ROLE_ID || '1335808165538955387',
    TRAINING_PANEL_THREAD_ID: process.env.TRAINING_PANEL_THREAD_ID || '1531864811405705236',
    TRAINING_COMPLETION_THREAD_ID: process.env.TRAINING_COMPLETION_THREAD_ID || process.env.TRAINING_LOG_CHANNEL_ID || '1531864745731297421',
    TRAINING_ATTENDANCE_THREAD_ID: process.env.TRAINING_ATTENDANCE_THREAD_ID || '1531864702123249755',
    RESIGNATION_REVIEW_THREAD_ID: process.env.RESIGNATION_REVIEW_THREAD_ID || '1534699797263417465',
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

    // ---- United Aviate training ----
    // TRAINING_STAFF_ROLE_ID (above) is the INSTRUCTOR role. Instructors hold it
    // PLUS their department role; students hold only their department role.
    // Role placed on a STUDENT while they're assigned to be trained. Removed
    // automatically when their instructor logs completion via /traininglog.
    TRAINING_INTRAINING_ROLE_ID: process.env.TRAINING_INTRAINING_ROLE_ID || '1464736853163774034',
    // Department roles, keyed to match the /traininglog training types.
    DEPARTMENT_ROLES: {
        'customer-service': process.env.DEPT_CUSTOMER_SERVICE_ROLE_ID || '1309634117440241684',
        'ramp-services': process.env.DEPT_RAMP_SERVICES_ROLE_ID || '1309634118404931616',
        'flight-crew': process.env.DEPT_FLIGHT_CREW_ROLE_ID || '1402230313567916095',
    },
};
