// models/Suggestion.js
const mongoose = require('mongoose');
 
const suggestionSchema = new mongoose.Schema({
    messageId: { type: String, required: true, unique: true },
    channelId: { type: String, required: true },
    guildId: { type: String, required: true },
 
    authorId: { type: String, required: true },
    authorUsername: { type: String, required: true },
 
    title: { type: String, required: true },
    description: { type: String, required: true },
    mediaUrl: { type: String, default: null },
 
    upvoters: { type: [String], default: [] },
    downvoters: { type: [String], default: [] },
 
    createdAt: { type: Date, default: Date.now },
    tallyAt: { type: Date, required: true },
    tallied: { type: Boolean, default: false },
    tallyResult: { type: String, default: null },       // 'approved' | 'rejected' | 'tied'
    forwardedMessageId: { type: String, default: null },
});
 
suggestionSchema.index({ tallied: 1, tallyAt: 1 });
 
module.exports = mongoose.model('DiscordSuggestion', suggestionSchema);
