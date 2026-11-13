-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'ORGANIZER', 'PARTICIPANT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BANNED', 'MERGED', 'DELETED');

-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('DUEL', 'TEAM_VS_TEAM', 'BATTLE_ROYALE');

-- CreateEnum
CREATE TYPE "TournamentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'REGISTRATION_CLOSED', 'CHECK_IN', 'IN_PROGRESS', 'PAUSED', 'FINISHED', 'ARCHIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ParticipantType" AS ENUM ('SOLO', 'TEAM');

-- CreateEnum
CREATE TYPE "StageFormat" AS ENUM ('SINGLE_ELIM', 'DOUBLE_ELIM', 'GROUPS', 'ROUND_ROBIN', 'SWISS', 'BATTLE_ROYALE', 'TEAM_VS_TEAM');

-- CreateEnum
CREATE TYPE "StageStatus" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED');

-- CreateEnum
CREATE TYPE "Seeding" AS ENUM ('RANDOM', 'RANKED', 'MANUAL');

-- CreateEnum
CREATE TYPE "BracketSide" AS ENUM ('WINNERS', 'LOSERS', 'FINAL', 'THIRD_PLACE');

-- CreateEnum
CREATE TYPE "MatchStatus" AS ENUM ('SCHEDULED', 'CHECK_IN', 'LIVE', 'AWAITING_VALIDATION', 'VALIDATED', 'DISPUTED', 'WALKOVER', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('PENDING_MEMBERS', 'PENDING_APPROVAL', 'CONFIRMED', 'WAITLIST', 'REJECTED', 'CANCELLED', 'WITHDRAWN', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TeamMemberRole" AS ENUM ('CAPTAIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('CO_ORGANIZER', 'MODERATOR');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CONTESTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "DisputeStatus" AS ENUM ('OPEN', 'ESCALATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportTarget" AS ENUM ('USER', 'TEAM', 'MATCH', 'RESULT');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'ACTIONED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "SanctionType" AS ENUM ('WARNING', 'SUSPENSION', 'BAN');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('REGISTRATION_CONFIRMED', 'TEAM_INVITE', 'CHECKIN_OPEN', 'MATCH_SOON', 'RESULT_POSTED', 'QUALIFIED', 'ELIMINATED', 'ANNOUNCEMENT', 'ORGANIZER_REQUEST_RESULT', 'DISPUTE_UPDATE', 'SANCTION');

-- CreateEnum
CREATE TYPE "OAuthProvider" AS ENUM ('google', 'discord');

-- CreateEnum
CREATE TYPE "EmailTokenType" AS ENUM ('VERIFY', 'RESET', 'CHANGE_EMAIL');

-- CreateEnum
CREATE TYPE "FollowTarget" AS ENUM ('TOURNAMENT', 'GAME');

-- CreateEnum
CREATE TYPE "ResultEventType" AS ENUM ('ENTERED', 'CORRECTED', 'WALKOVER', 'REVERTED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "nickname" TEXT NOT NULL,
    "nicknameKey" TEXT NOT NULL,
    "passwordHash" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "birthDate" DATE,
    "avatarUrl" TEXT,
    "country" TEXT,
    "state" TEXT,
    "bio" TEXT,
    "socials" JSONB NOT NULL DEFAULT '{}',
    "timezone" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "lastSeenAt" TIMESTAMPTZ(3),
    "mergedIntoId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_roles" (
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "grantedById" UUID,
    "grantedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_roles_pkey" PRIMARY KEY ("userId","role")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "familyId" UUID NOT NULL,
    "refreshTokenHash" TEXT NOT NULL,
    "userAgent" TEXT,
    "ip" TEXT,
    "twoFactorVerified" BOOLEAN NOT NULL DEFAULT false,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "replacedById" UUID,
    "lastUsedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "provider" "OAuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "email" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "two_factor" (
    "userId" UUID NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enabledAt" TIMESTAMPTZ(3),
    "recoveryCodesHash" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "two_factor_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "email_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "EmailTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "newEmail" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_invites" (
    "id" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizer_requests" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "justification" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedById" UUID,
    "reviewReason" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizer_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizer_limits" (
    "userId" UUID NOT NULL,
    "maxActiveTournaments" INTEGER NOT NULL DEFAULT 3,
    "allowedGameIds" UUID[],
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizer_limits_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "admin_removal_requests" (
    "id" UUID NOT NULL,
    "targetUserId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_removal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "fields" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "games" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '🎮',
    "coverUrl" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'mobile',
    "requiredAccountFields" JSONB NOT NULL DEFAULT '[]',
    "extraStatFields" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "games_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "game_modes" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "teamSize" INTEGER NOT NULL,
    "maxSubs" INTEGER NOT NULL DEFAULT 0,
    "matchType" "MatchType" NOT NULL,
    "maxLobbySize" INTEGER,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "game_modes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_models" (
    "id" UUID NOT NULL,
    "gameId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "matchType" "MatchType" NOT NULL,
    "rules" JSONB NOT NULL,
    "tiebreakers" JSONB NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "scoring_models_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournaments" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "gameId" UUID NOT NULL,
    "gameModeId" UUID NOT NULL,
    "ownerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "rules" TEXT NOT NULL DEFAULT '',
    "prize" TEXT NOT NULL DEFAULT '',
    "bannerUrl" TEXT,
    "streamUrls" TEXT[],
    "status" "TournamentStatus" NOT NULL DEFAULT 'DRAFT',
    "participantType" "ParticipantType" NOT NULL,
    "maxParticipants" INTEGER NOT NULL,
    "registrationOpensAt" TIMESTAMPTZ(3),
    "registrationClosesAt" TIMESTAMPTZ(3),
    "startsAt" TIMESTAMPTZ(3),
    "manualApproval" BOOLEAN NOT NULL DEFAULT false,
    "waitlistEnabled" BOOLEAN NOT NULL DEFAULT true,
    "checkInConfig" JSONB NOT NULL DEFAULT '{}',
    "rosterLockAt" TIMESTAMPTZ(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "draftStep" INTEGER,
    "statusReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournaments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tournament_staff" (
    "tournamentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "StaffRole" NOT NULL,
    "addedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tournament_staff_pkey" PRIMARY KEY ("tournamentId","userId")
);

-- CreateTable
CREATE TABLE "tournament_templates" (
    "id" UUID NOT NULL,
    "ownerId" UUID,
    "name" TEXT NOT NULL,
    "gameId" UUID NOT NULL,
    "gameModeId" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tournament_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stages" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "format" "StageFormat" NOT NULL,
    "scoringModelId" UUID NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "qualification" JSONB,
    "tiebreakers" JSONB NOT NULL DEFAULT '[]',
    "seeding" "Seeding" NOT NULL DEFAULT 'RANDOM',
    "randomSeed" TEXT,
    "status" "StageStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "groups" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "groupId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("groupId","registrationId")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" UUID NOT NULL,
    "tournamentId" UUID,
    "stageId" UUID,
    "groupId" UUID,
    "authorId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follows" (
    "userId" UUID NOT NULL,
    "targetType" "FollowTarget" NOT NULL,
    "targetId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follows_pkey" PRIMARY KEY ("userId","targetType","targetId")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "logoUrl" TEXT,
    "captainId" UUID NOT NULL,
    "gameId" UUID,
    "archivedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "teamId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "TeamMemberRole" NOT NULL DEFAULT 'MEMBER',
    "isSub" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("teamId","userId")
);

-- CreateTable
CREATE TABLE "team_invites" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "invitedUserId" UUID,
    "code" TEXT NOT NULL,
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registrations" (
    "id" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "userId" UUID,
    "teamId" UUID,
    "displayName" TEXT,
    "tag" TEXT,
    "status" "RegistrationStatus" NOT NULL,
    "seed" INTEGER,
    "checkedInAt" TIMESTAMPTZ(3),
    "rulesAcceptedAt" TIMESTAMPTZ(3),
    "statusReason" TEXT,
    "reservedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registration_members" (
    "id" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "tournamentId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "confirmedAt" TIMESTAMPTZ(3),
    "isSub" BOOLEAN NOT NULL DEFAULT false,
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registration_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "matches" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "groupId" UUID,
    "nodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DUEL',
    "round" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "bracket" "BracketSide",
    "roundLabel" TEXT NOT NULL DEFAULT '',
    "dropIndex" INTEGER,
    "bestOf" INTEGER NOT NULL DEFAULT 1,
    "ifNecessary" BOOLEAN NOT NULL DEFAULT false,
    "nextMatchId" UUID,
    "loserNextMatchId" UUID,
    "scheduledAt" TIMESTAMPTZ(3),
    "lobbyCodeEnc" TEXT,
    "status" "MatchStatus" NOT NULL DEFAULT 'SCHEDULED',
    "multiplier" DECIMAL(6,2) NOT NULL DEFAULT 1,
    "evidenceUrls" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "matches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "match_participants" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "placement" INTEGER,
    "kills" INTEGER,
    "score" DECIMAL(10,2),
    "isWinner" BOOLEAN,
    "absent" BOOLEAN NOT NULL DEFAULT false,
    "points" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "rawStats" JSONB NOT NULL DEFAULT '{}',
    "walkover" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "match_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_stats" (
    "id" UUID NOT NULL,
    "matchParticipantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "stats" JSONB NOT NULL,

    CONSTRAINT "player_stats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "check_ins" (
    "matchId" UUID NOT NULL,
    "registrationId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "check_ins_pkey" PRIMARY KEY ("matchId","registrationId","userId")
);

-- CreateTable
CREATE TABLE "standings" (
    "id" UUID NOT NULL,
    "stageId" UUID NOT NULL,
    "groupId" UUID,
    "registrationId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "points" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "booyahs" INTEGER NOT NULL DEFAULT 0,
    "kills" INTEGER NOT NULL DEFAULT 0,
    "scoreFor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "scoreAgainst" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "avgPlacement" DECIMAL(6,2),
    "tiebreakNote" TEXT,
    "qualified" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "standings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_submissions" (
    "id" UUID NOT NULL,
    "matchId" UUID NOT NULL,
    "submittedById" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "SubmissionStatus" NOT NULL DEFAULT 'PENDING',
    "confirmedById" UUID,
    "reviewedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "result_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disputes" (
    "id" UUID NOT NULL,
    "submissionId" UUID,
    "matchId" UUID NOT NULL,
    "openedById" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "DisputeStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispute_messages" (
    "id" UUID NOT NULL,
    "disputeId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispute_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "result_events" (
    "id" BIGSERIAL NOT NULL,
    "matchId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "type" "ResultEventType" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "result_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "tournamentId" UUID,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporterId" UUID NOT NULL,
    "targetType" "ReportTarget" NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "handledById" UUID,
    "resolution" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sanctions" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "SanctionType" NOT NULL,
    "reason" TEXT NOT NULL,
    "issuedById" UUID NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMPTZ(3),
    "liftedAt" TIMESTAMPTZ(3),
    "reportId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMPTZ(3),
    "emailSentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "userId" UUID NOT NULL,
    "type" "NotificationType" NOT NULL,
    "inApp" BOOLEAN NOT NULL DEFAULT true,
    "email" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("userId","type")
);

-- CreateTable
CREATE TABLE "achievements" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "gameId" UUID,
    "type" TEXT NOT NULL,
    "tournamentId" UUID,
    "awardedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "achievements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "site_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "site_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_nicknameKey_key" ON "users"("nicknameKey");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "user_roles_role_idx" ON "user_roles"("role");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refreshTokenHash_key" ON "sessions"("refreshTokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_familyId_idx" ON "sessions"("familyId");

-- CreateIndex
CREATE INDEX "oauth_accounts_userId_idx" ON "oauth_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_accounts_provider_providerAccountId_key" ON "oauth_accounts"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "email_tokens_tokenHash_key" ON "email_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "email_tokens_userId_type_idx" ON "email_tokens"("userId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "role_invites_tokenHash_key" ON "role_invites"("tokenHash");

-- CreateIndex
CREATE INDEX "organizer_requests_status_createdAt_idx" ON "organizer_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "organizer_requests_userId_idx" ON "organizer_requests"("userId");

-- CreateIndex
CREATE INDEX "admin_removal_requests_status_idx" ON "admin_removal_requests"("status");

-- CreateIndex
CREATE UNIQUE INDEX "game_accounts_userId_gameId_key" ON "game_accounts"("userId", "gameId");

-- CreateIndex
CREATE UNIQUE INDEX "games_slug_key" ON "games"("slug");

-- CreateIndex
CREATE INDEX "games_active_idx" ON "games"("active");

-- CreateIndex
CREATE INDEX "game_modes_gameId_idx" ON "game_modes"("gameId");

-- CreateIndex
CREATE INDEX "scoring_models_gameId_idx" ON "scoring_models"("gameId");

-- CreateIndex
CREATE INDEX "scoring_models_ownerId_idx" ON "scoring_models"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "tournaments_slug_key" ON "tournaments"("slug");

-- CreateIndex
CREATE INDEX "tournaments_status_startsAt_idx" ON "tournaments"("status", "startsAt");

-- CreateIndex
CREATE INDEX "tournaments_gameId_status_idx" ON "tournaments"("gameId", "status");

-- CreateIndex
CREATE INDEX "tournaments_ownerId_idx" ON "tournaments"("ownerId");

-- CreateIndex
CREATE INDEX "tournaments_featured_idx" ON "tournaments"("featured");

-- CreateIndex
CREATE INDEX "tournament_staff_userId_idx" ON "tournament_staff"("userId");

-- CreateIndex
CREATE INDEX "tournament_templates_ownerId_idx" ON "tournament_templates"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "stages_tournamentId_order_key" ON "stages"("tournamentId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "groups_stageId_order_key" ON "groups"("stageId", "order");

-- CreateIndex
CREATE INDEX "group_members_registrationId_idx" ON "group_members"("registrationId");

-- CreateIndex
CREATE INDEX "announcements_tournamentId_createdAt_idx" ON "announcements"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "follows_targetType_targetId_idx" ON "follows"("targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "teams_tag_key" ON "teams"("tag");

-- CreateIndex
CREATE INDEX "teams_captainId_idx" ON "teams"("captainId");

-- CreateIndex
CREATE INDEX "team_members_userId_idx" ON "team_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "team_invites_code_key" ON "team_invites"("code");

-- CreateIndex
CREATE INDEX "team_invites_teamId_status_idx" ON "team_invites"("teamId", "status");

-- CreateIndex
CREATE INDEX "team_invites_invitedUserId_status_idx" ON "team_invites"("invitedUserId", "status");

-- CreateIndex
CREATE INDEX "registrations_tournamentId_status_createdAt_idx" ON "registrations"("tournamentId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_tournamentId_userId_key" ON "registrations"("tournamentId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "registrations_tournamentId_teamId_key" ON "registrations"("tournamentId", "teamId");

-- CreateIndex
CREATE INDEX "registration_members_registrationId_idx" ON "registration_members"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "registration_members_tournamentId_userId_key" ON "registration_members"("tournamentId", "userId");

-- CreateIndex
CREATE INDEX "matches_stageId_round_position_idx" ON "matches"("stageId", "round", "position");

-- CreateIndex
CREATE INDEX "matches_scheduledAt_idx" ON "matches"("scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "matches_stageId_nodeId_key" ON "matches"("stageId", "nodeId");

-- CreateIndex
CREATE INDEX "match_participants_registrationId_idx" ON "match_participants"("registrationId");

-- CreateIndex
CREATE UNIQUE INDEX "match_participants_matchId_registrationId_key" ON "match_participants"("matchId", "registrationId");

-- CreateIndex
CREATE INDEX "player_stats_userId_idx" ON "player_stats"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "player_stats_matchParticipantId_userId_key" ON "player_stats"("matchParticipantId", "userId");

-- CreateIndex
CREATE INDEX "standings_stageId_groupId_position_idx" ON "standings"("stageId", "groupId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "standings_stageId_registrationId_key" ON "standings"("stageId", "registrationId");

-- CreateIndex
CREATE INDEX "result_submissions_matchId_status_idx" ON "result_submissions"("matchId", "status");

-- CreateIndex
CREATE INDEX "disputes_status_createdAt_idx" ON "disputes"("status", "createdAt");

-- CreateIndex
CREATE INDEX "disputes_matchId_idx" ON "disputes"("matchId");

-- CreateIndex
CREATE INDEX "dispute_messages_disputeId_createdAt_idx" ON "dispute_messages"("disputeId", "createdAt");

-- CreateIndex
CREATE INDEX "result_events_matchId_createdAt_idx" ON "result_events"("matchId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_tournamentId_createdAt_idx" ON "audit_logs"("tournamentId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_createdAt_idx" ON "audit_logs"("action", "createdAt");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_targetType_targetId_idx" ON "reports"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "sanctions_userId_startsAt_idx" ON "sanctions"("userId", "startsAt");

-- CreateIndex
CREATE INDEX "notifications_userId_readAt_createdAt_idx" ON "notifications"("userId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "achievements_userId_awardedAt_idx" ON "achievements"("userId", "awardedAt");

-- AddForeignKey
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_accounts" ADD CONSTRAINT "oauth_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "two_factor" ADD CONSTRAINT "two_factor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_tokens" ADD CONSTRAINT "email_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizer_requests" ADD CONSTRAINT "organizer_requests_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organizer_limits" ADD CONSTRAINT "organizer_limits_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_accounts" ADD CONSTRAINT "game_accounts_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "game_modes" ADD CONSTRAINT "game_modes_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_gameModeId_fkey" FOREIGN KEY ("gameModeId") REFERENCES "game_modes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournaments" ADD CONSTRAINT "tournaments_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_staff" ADD CONSTRAINT "tournament_staff_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_staff" ADD CONSTRAINT "tournament_staff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tournament_templates" ADD CONSTRAINT "tournament_templates_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stages" ADD CONSTRAINT "stages_scoringModelId_fkey" FOREIGN KEY ("scoringModelId") REFERENCES "scoring_models"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follows" ADD CONSTRAINT "follows_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_captainId_fkey" FOREIGN KEY ("captainId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "games"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_invites" ADD CONSTRAINT "team_invites_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "tournaments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registration_members" ADD CONSTRAINT "registration_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "matches" ADD CONSTRAINT "matches_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "match_participants" ADD CONSTRAINT "match_participants_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_matchParticipantId_fkey" FOREIGN KEY ("matchParticipantId") REFERENCES "match_participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_stats" ADD CONSTRAINT "player_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "check_ins" ADD CONSTRAINT "check_ins_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_stageId_fkey" FOREIGN KEY ("stageId") REFERENCES "stages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "standings" ADD CONSTRAINT "standings_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "registrations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_submissions" ADD CONSTRAINT "result_submissions_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "result_submissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispute_messages" ADD CONSTRAINT "dispute_messages_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "disputes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "result_events" ADD CONSTRAINT "result_events_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "matches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
