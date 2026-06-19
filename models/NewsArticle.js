// models/NewsArticle.js — tracks United newsroom articles the bot has already seen,
// so it never reposts and never dumps a backlog after a restart.
const mongoose = require('mongoose');

const NewsArticleSchema = new mongoose.Schema({
    // Stable identifier = the mediaroom permalink slug (e.g. "2026-06-02-Newark-Liberty-...").
    articleId: { type: String, required: true, unique: true, index: true },
    title: { type: String },
    url: { type: String },        // link shown in the post (consumer united.com URL when available)
    sourceUrl: { type: String },  // the mediaroom page actually fetched
    summary: { type: String },
    posted: { type: Boolean, default: false },   // true once announced in the channel
    ignored: { type: Boolean, default: false },  // candidate that turned out not to be a press release
    seeded: { type: Boolean, default: false },   // recorded during first-run seed (intentionally not posted)
}, { timestamps: true });

module.exports = mongoose.model('NewsArticle', NewsArticleSchema);
