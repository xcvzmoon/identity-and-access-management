import { createTransport } from 'nodemailer';

export type AccountCodeMail = { email: string; otp: string };
export type AccountCodeMailer = (message: AccountCodeMail) => Promise<void>;
type OrganizationInvitationMail = { email: string; organizationName: string };
export type OrganizationInvitationMailer = (message: OrganizationInvitationMail) => Promise<void>;
type AccountMail =
  | (AccountCodeMail & { purpose: 'password-recovery' })
  | (OrganizationInvitationMail & { purpose: 'organization-invitation'; accountUrl: string });
type AccountMailer = (message: AccountMail) => Promise<void>;
type MailContent = { subject: string; text: string };

const implicitTlsPort = 465;
const startTlsPort = 587;
const smtpTimeoutMs = 5000;

function describeMail(message: AccountMail): MailContent {
  if (message.purpose === 'organization-invitation') {
    return {
      subject: 'You have an IAM organization invitation',
      text: `You were invited to join ${message.organizationName}. Create an IAM account with this email address if needed, then sign in and open your account to accept the invitation.\n\n${message.accountUrl}`,
    };
  }

  return {
    subject: 'Set or reset your IAM password',
    text: `Your IAM email verification and password code is ${message.otp}. Enter it on the IAM page where you requested it. It expires in five minutes. If you did not request this code, ignore this email.`,
  };
}

export function createAccountMailer(url: string, from: string): AccountMailer {
  const relay = new URL(url);
  const secure = relay.protocol === 'smtps:';
  const defaultPort = secure ? implicitTlsPort : startTlsPort;
  const connection = {
    host: relay.hostname,
    port: relay.port ? Number(relay.port) : defaultPort,
    secure,
    requireTLS: !secure,
    connectionTimeout: smtpTimeoutMs,
    greetingTimeout: smtpTimeoutMs,
    socketTimeout: smtpTimeoutMs,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
  const transport = createTransport(
    relay.username
      ? {
          ...connection,
          auth: {
            user: decodeURIComponent(relay.username),
            pass: decodeURIComponent(relay.password),
          },
        }
      : connection,
  );

  return async (message) => {
    await transport.sendMail({
      from,
      to: {
        address: message.email,
        name: '',
      },
      ...describeMail(message),
    });
  };
}
