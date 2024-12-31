import sgMail from '@sendgrid/mail';
import { Validator } from 'jsonschema';
import { QueryResult } from 'pg';
import { log_error } from './utils';
import emailRequestSchema from '../json_schemas/email-request-schema';
import db from '../config/db';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
} else {
  throw new Error('SENDGRID_API_KEY is not defined');
}

export interface IEmail {
  to?: string[];
  subject: string;
  html: string;
}

export class EmailRequest implements IEmail {
  public readonly html: string;
  public readonly subject: string;
  public readonly to: string[];

  constructor(toEmails: string[], subject: string, content: string) {
    this.to = toEmails;
    this.subject = subject;
    this.html = content;
  }
}

function isValidMailBody(body: IEmail) {
  const validator = new Validator();
  return validator.validate(body, emailRequestSchema).valid;
}

async function removeMails(query: string, emails: string[]) {
  const result: QueryResult<{ email: string }> = await db.query(query, []);
  const bouncedEmails = result.rows.map(e => e.email);
  for (let i = 0; i < emails.length; i++) {
    const email = emails[i];
    if (bouncedEmails.includes(email)) {
      emails.splice(i, 1);
    }
  }
}

async function filterSpamEmails(emails: string[]): Promise<void> {
  await removeMails('SELECT email FROM spam_emails ORDER BY email;', emails);
}

async function filterBouncedEmails(emails: string[]): Promise<void> {
  await removeMails('SELECT email FROM bounced_emails ORDER BY email;', emails);
}

export async function sendEmail(email: IEmail): Promise<string | null> {
  try {
    const options = { ...email } as IEmail;
    options.to = Array.isArray(options.to) ? Array.from(new Set(options.to)) : [];

    if (options.to.length) {
      await filterBouncedEmails(options.to);
      await filterSpamEmails(options.to);
    }

    if (!isValidMailBody(options)) return null;

    const msg = {
      to: options.to,
      from: process.env.SENDGRID_FROM_EMAIL || 'default@example.com',
      subject: options.subject,
      html: options.html,
    };

    const res = await sgMail.send(msg);
    return res[0].statusCode === 202 ? 'Email sent successfully' : null;
  } catch (e) {
    log_error(e);
  }

  return null;
}
