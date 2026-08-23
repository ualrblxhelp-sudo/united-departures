'use strict';

const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const {
  GUARDED_ROLE_RANK,
  MIN_GRANTER_RANK,
} = require('../services/rank77Watchdog');

/**
 * /seniortechops authorize <user id> [reason]
 * /seniortechops revoke    <user id>
 * /seniortechops list
 * /seniortechops sweep
 *
 * VISIBILITY
 * ----------
 * Registered to the Volare guild ONLY. Do not add this to the main guild's
 * command list -- guild-scoped registration is what keeps it off the main
 * server entirely, not a runtime check.
 *
 * Within Volare it is hidden by setDefaultMemberPermissions(0), which removes
 * it from everyone including administrators until explicitly allowed. Grant it
 * to GATE_ROLE_ID under Server Settings -> Integrations -> (bot) -> Command
 * Permissions. That is what makes it invisible in the picker for other staff.
 *
 * AUTHORIZATION
 * -------------
 * Two independent gates, both enforced at call time:
 *   1. Discord: caller's highest role must sit at or above GATE_ROLE_ID.
 *   2. Roblox:  caller's group rank must be MIN_GRANTER_RANK+ (checked inside
 *               the watchdog for authorize/revoke).
 * Discord permissions alone are not sufficient, because the thing being
 * guarded is a Roblox role.
 */

const VOLARE_GUILD_ID = '1309560657473179679';
const GATE_ROLE_ID = '1309564307142606848';

function formatTechOpsError(err) {
  if (!err) return 'An unknown error occurred.';

  if (err.status === 401) {
    return 'Roblox access is misconfigured. `ROBLOX_OPENCLOUD_KEY` must be a Roblox User API key or OAuth token with the required group scopes.';
  }

  return err.message || 'An unknown error occurred.';
}

function formatAuthorizationLines(records) {
  return records
    .map(
      (r) =>
        `\`${r.userId}\` - granted by \`${r.grantedBy}\` (rank ${r.grantedByRank})` +
        (r.reason ? `\n> ${r.reason}` : '')
    )
    .join('\n\n')
    .slice(0, 1024);
}

function formatHolderLines(holders, authorizedIds) {
  return holders
    .map((holder) => {
      const status = authorizedIds.has(String(holder.userId))
        ? 'authorized'
        : 'not in store';
      return `\`${holder.userId}\` - ${status}`;
    })
    .join('\n')
    .slice(0, 1024);
}

/**
 * True if the member holds GATE_ROLE_ID, or any role positioned above it.
 * Uses position rather than a role ID list so a future senior role added above
 * this one inherits access without a code change.
 */
function meetsRoleGate(member) {
  if (!member || !member.guild) {
    return false;
  }

  const gateRole = member.guild.roles.cache.get(GATE_ROLE_ID);
  if (!gateRole) {
    return false;
  }

  // Guild owner always passes; they can grant themselves the role anyway.
  if (member.id === member.guild.ownerId) {
    return true;
  }

  return member.roles.cache.some((role) => role.position >= gateRole.position);
}

module.exports = {
  // Consumed by the registration step so this lands in Volare only.
  guildOnly: VOLARE_GUILD_ID,
  gateRoleId: GATE_ROLE_ID,

  data: new SlashCommandBuilder()
    .setName('seniortechops')
    .setDescription(`Manage who may hold group rank ${GUARDED_ROLE_RANK}`)
    // Hidden from everyone until allowed per-role in Integrations.
    .setDefaultMemberPermissions(0)
    .setDMPermission(false)
    .addSubcommand((sub) =>
      sub
        .setName('authorize')
        .setDescription('Permit a Roblox user to hold the guarded rank')
        .addStringOption((opt) =>
          opt
            .setName('user_id')
            .setDescription('Roblox user ID')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('reason').setDescription('Why this is being granted')
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('revoke')
        .setDescription('Withdraw permission to hold the guarded rank')
        .addStringOption((opt) =>
          opt
            .setName('user_id')
            .setDescription('Roblox user ID')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('list').setDescription('Show everyone currently authorized')
    )
    .addSubcommand((sub) =>
      sub.setName('sweep').setDescription('Run a check immediately')
    ),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {{ watchdog: object, resolveRoblox: Function }} ctx
   */
  async execute(interaction, ctx) {
    ctx = ctx || {};
    const { watchdog, resolveRoblox } = ctx;

    if (!watchdog || typeof resolveRoblox !== 'function') {
      return interaction.reply({
        content: 'Senior Tech Ops services are not available right now. Try again shortly.',
        flags: MessageFlags.Ephemeral,
      });
    }

    // Guild gate. Belt-and-braces alongside guild-scoped registration.
    if (interaction.guildId !== VOLARE_GUILD_ID) {
      return interaction.reply({
        content: 'This command is only available in the Volare server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Role gate. Fetch rather than trusting cache, so a just-removed role is
    // reflected immediately.
    let member;
    try {
      member = await interaction.guild.members.fetch(interaction.user.id);
    } catch {
      return interaction.editReply('Could not verify your roles. Try again shortly.');
    }

    if (!meetsRoleGate(member)) {
      return interaction.editReply('You do not have permission to use this command.');
    }

    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const records = await watchdog.store.all();
      const authorizedIds = new Set(records.map((record) => String(record.userId)));
      let holders = [];
      let liveError = null;

      try {
        holders = await watchdog.listGuardedMembers();
      } catch (err) {
        liveError = formatTechOpsError(err);
      }

      if (!records.length && !holders.length) {
        if (liveError) {
          return interaction.editReply(
            'No stored authorizations were found, and the live Roblox holder check is unavailable right now.\n' +
              liveError
          );
        }

        return interaction.editReply(
          `No stored authorizations were found, and nobody is currently holding rank ${GUARDED_ROLE_RANK}.`
        );
      }

      const embed = new EmbedBuilder()
        .setTitle(`Rank ${GUARDED_ROLE_RANK} senior tech ops status`)
        .setColor(0x0033a0)
        .setFooter({ text: 'United Airlines' });

      embed.addFields({
        name: 'Stored Authorizations',
        value: records.length
          ? formatAuthorizationLines(records)
          : 'None recorded in MongoDB.',
      });

      if (holders.length) {
        embed.addFields({
          name: `Current Rank ${GUARDED_ROLE_RANK} Holders`,
          value: formatHolderLines(holders, authorizedIds),
        });
      } else if (liveError) {
        embed.addFields({
          name: 'Current Holder Check',
          value: liveError.slice(0, 1024),
        });
      } else {
        embed.addFields({
          name: `Current Rank ${GUARDED_ROLE_RANK} Holders`,
          value: 'Nobody currently holds this rank.',
        });
      }

      return interaction.editReply({ embeds: [embed] });
    }

    // Bloxlink: Discord ID -> Roblox user ID
    let callerRobloxId;
    try {
      callerRobloxId = await resolveRoblox(interaction.user.id);
    } catch (err) {
      return interaction.editReply(
        `Could not resolve your Roblox account: ${err.message}`
      );
    }

    if (!callerRobloxId) {
      return interaction.editReply(
        'Your Discord account is not linked to Roblox. Verify with Bloxlink first.'
      );
    }

    if (sub === 'authorize') {
      const target = interaction.options.getString('user_id');
      const reason = interaction.options.getString('reason');

      if (!/^\d+$/.test(target)) {
        return interaction.editReply(
          'That is not a valid Roblox user ID. Expecting digits only.'
        );
      }

      let result;
      try {
        result = await watchdog.authorize({
          targetUserId: target,
          granterUserId: callerRobloxId,
          reason,
        });
      } catch (err) {
        return interaction.editReply(formatTechOpsError(err));
      }

      if (!result.ok) {
        return interaction.editReply(result.error);
      }

      return interaction.editReply(
        `Roblox user \`${target}\` may now hold rank ${GUARDED_ROLE_RANK}. ` +
          'They still need ranking manually; this only stops the watchdog reverting it.'
      );
    }

    if (sub === 'revoke') {
      const target = interaction.options.getString('user_id');

      if (!/^\d+$/.test(target)) {
        return interaction.editReply(
          'That is not a valid Roblox user ID. Expecting digits only.'
        );
      }

      let result;
      try {
        result = await watchdog.revoke({
          targetUserId: target,
          actorUserId: callerRobloxId,
        });
      } catch (err) {
        return interaction.editReply(formatTechOpsError(err));
      }

      if (!result.ok) {
        return interaction.editReply(result.error);
      }

      return interaction.editReply(
        `Authorization for \`${target}\` withdrawn. If they currently hold rank ` +
          `${GUARDED_ROLE_RANK} they will be reverted on the next sweep.`
      );
    }

    if (sub === 'sweep') {
      let caller;
      try {
        caller = await watchdog.getRank(callerRobloxId);
      } catch (err) {
        return interaction.editReply(formatTechOpsError(err));
      }

      if (!caller || caller.rank < MIN_GRANTER_RANK) {
        return interaction.editReply(
          `Running a sweep requires group rank ${MIN_GRANTER_RANK}+.`
        );
      }

      let result;
      try {
        result = await watchdog.sweep();
      } catch (err) {
        return interaction.editReply(formatTechOpsError(err));
      }

      return interaction.editReply(
        `Sweep complete. Checked ${result.checked} holder(s), ` +
          `reverted ${result.reverted}, ${result.errors} error(s).`
      );
    }

    return interaction.editReply('Unknown subcommand.');
  },
};
