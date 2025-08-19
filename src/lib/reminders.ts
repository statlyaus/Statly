import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { formatInTimezone, calculateReminderTimes } from '@/lib/timezone';
import { addMinutes } from 'date-fns';

export type ReminderType = 'email' | 'sms' | 'push' | 'in_app';

export interface ReminderTemplate {
  type: ReminderType;
  timeBeforeDraft: number; // minutes
  subject: string;
  message: string;
}

export const DEFAULT_REMINDER_TEMPLATES: ReminderTemplate[] = [
  {
    type: 'email',
    timeBeforeDraft: 24 * 60, // 24 hours
    subject: 'Draft Tomorrow: {{draftName}}',
    message: `Hi {{userName}},

Your fantasy draft "{{draftName}}" is scheduled for tomorrow at {{draftTime}}.

📅 When: {{draftDateTime}}
⏱️ Time per pick: {{timePerPick}} seconds
👥 League size: {{leagueSize}} teams

Make sure to:
• Set up your player queue in advance
• Be online 15 minutes before start time
• Have a backup internet connection ready

Join the draft: {{draftUrl}}

Good luck!`,
  },
  {
    type: 'email',
    timeBeforeDraft: 2 * 60, // 2 hours
    subject: 'Draft Starting Soon: {{draftName}}',
    message: `Hi {{userName}},

Your fantasy draft "{{draftName}}" starts in 2 hours!

📅 Start time: {{draftTime}}
🔗 Join now: {{draftUrl}}

Last chance to:
• Review your player queue
• Check your internet connection
• Grab some snacks! 🍕

See you in the draft room!`,
  },
  {
    type: 'push',
    timeBeforeDraft: 30, // 30 minutes
    subject: 'Draft in 30 minutes!',
    message: '{{draftName}} starts in 30 minutes. Join the draft room now!',
  },
  {
    type: 'push',
    timeBeforeDraft: 15, // 15 minutes
    subject: 'Draft starting soon!',
    message: '{{draftName}} starts in 15 minutes. Last call!',
  },
];

/**
 * Create reminders for a draft
 */
export async function createDraftReminders(
  draftId: string,
  draftStartTime: Date,
  participantIds: string[],
  templates: ReminderTemplate[] = DEFAULT_REMINDER_TEMPLATES
): Promise<void> {
  try {
    const reminders = [];

    for (const participantId of participantIds) {
      for (const template of templates) {
        const reminderTime = addMinutes(draftStartTime, -template.timeBeforeDraft);
        
        // Only create reminders for future times
        if (reminderTime > new Date()) {
          reminders.push({
            id: `${draftId}_${participantId}_${template.type}_${template.timeBeforeDraft}`,
            draftId,
            userId: participantId,
            reminderType: template.type,
            scheduledFor: reminderTime,
            message: template.message,
          });
        }
      }
    }

    if (reminders.length > 0) {
      await prisma.draftReminder.createMany({
        data: reminders,
        skipDuplicates: true,
      });

      logger.info('Draft reminders created', {
        draftId,
        reminderCount: reminders.length,
        participantCount: participantIds.length,
      });
    }
  } catch (error) {
    logger.error('Failed to create draft reminders', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Update reminders when draft is rescheduled
 */
export async function updateDraftReminders(
  draftId: string,
  newStartTime: Date,
  participantIds: string[]
): Promise<void> {
  try {
    // Delete existing reminders
    await prisma.draftReminder.deleteMany({
      where: { draftId, sent: false },
    });

    // Create new reminders
    await createDraftReminders(draftId, newStartTime, participantIds);

    logger.info('Draft reminders updated', {
      draftId,
      newStartTime: newStartTime.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to update draft reminders', {
      draftId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Process pending reminders (called by cron job)
 */
export async function processPendingReminders(): Promise<void> {
  try {
    const now = new Date();
    
    const pendingReminders = await prisma.draftReminder.findMany({
      where: {
        sent: false,
        scheduledFor: { lte: now },
      },
      include: {
        draft: {
          include: {
            league: {
              include: {
                settings: true,
                members: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
        user: true,
      },
    });

    logger.info('Processing pending reminders', {
      count: pendingReminders.length,
    });

    for (const reminder of pendingReminders) {
      try {
        await sendReminder(reminder);
        
        // Mark as sent
        await prisma.draftReminder.update({
          where: { id: reminder.id },
          data: {
            sent: true,
            sentAt: new Date(),
          },
        });
      } catch (error) {
        logger.error('Failed to send reminder', {
          reminderId: reminder.id,
          draftId: reminder.draftId,
          userId: reminder.userId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } catch (error) {
    logger.error('Failed to process pending reminders', {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send a single reminder
 */
async function sendReminder(reminder: any): Promise<void> {
  const { draft, user } = reminder;
  const userTimeZone = user.preferredTimeZone || 'UTC';
  const draftTimeZone = draft.league?.settings?.timeZone || 'UTC';

  // Prepare template variables
  const variables = {
    userName: user.displayName || user.email,
    draftName: draft.league?.name || 'Fantasy Draft',
    draftTime: formatInTimezone(draft.league?.settings?.startAt || new Date(), userTimeZone, 'p'),
    draftDateTime: formatInTimezone(draft.league?.settings?.startAt || new Date(), userTimeZone, 'PPP p'),
    timePerPick: draft.league?.settings?.pickSeconds || 120,
    leagueSize: draft.league?.settings?.maxTeams || 12,
    draftUrl: `${process.env.NEXT_PUBLIC_APP_URL}/drafts/${draft.id}`,
  };

  // Replace template variables
  let message = reminder.message;
  Object.entries(variables).forEach(([key, value]) => {
    message = message.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  });

  // Send based on reminder type
  switch (reminder.reminderType) {
    case 'email':
      await sendEmailReminder(user.email, `Draft Reminder: ${variables.draftName}`, message);
      break;
    case 'sms':
      // await sendSMSReminder(user.phone, message);
      logger.info('SMS reminder would be sent', { userId: user.id, message });
      break;
    case 'push':
      await sendPushNotification(user.id, 'Draft Reminder', message);
      break;
    case 'in_app':
      await createInAppNotification(user.id, 'Draft Reminder', message);
      break;
  }

  logger.info('Reminder sent', {
    reminderId: reminder.id,
    type: reminder.reminderType,
    userId: user.id,
    draftId: draft.id,
  });
}

/**
 * Send email reminder (placeholder - integrate with your email service)
 */
async function sendEmailReminder(email: string, subject: string, message: string): Promise<void> {
  // TODO: Integrate with your email service (SendGrid, AWS SES, etc.)
  logger.info('Email reminder would be sent', { email, subject });
}

/**
 * Send push notification (placeholder)
 */
async function sendPushNotification(userId: string, title: string, message: string): Promise<void> {
  // TODO: Integrate with push notification service
  logger.info('Push notification would be sent', { userId, title, message });
}

/**
 * Create in-app notification
 */
async function createInAppNotification(userId: string, title: string, message: string): Promise<void> {
  // TODO: Create in-app notification record
  logger.info('In-app notification created', { userId, title, message });
}
