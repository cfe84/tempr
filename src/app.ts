import * as fs from "fs";
import * as dotenv from "dotenv";
import { default as ImapClient, ImapClientOptions } from "emailjs-imap-client";

dotenv.config();

interface AppConfig {
  host: string,
  port: number,
  user: string,
  password: string,
  listenPort: number,
}

export class App {
  private config: AppConfig
  private lastChecks: Date[] = [];

  constructor() {
    this.config = this.loadConfig();
  }

  private loadConfig(): AppConfig {
    return {
        host: process.env.IMAP_HOST || "",
        port: Number.parseInt(process.env.IMAP_PORT ?? "993"),
        user: process.env.IMAP_USER || "",
        password: process.env.IMAP_PASSWORD || "",
        listenPort: Number.parseInt(process.env.PORT ?? "8080"),
    }
  }

  private async connectAsync(): Promise<ImapClient> {
    process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = "0"
    const options: ImapClientOptions = {
      logLevel: 40,
      auth: {
        user: this.config.user,
        pass: this.config.password
      },
      requireTLS: true
    }

    const client = new ImapClient(this.config.host, this.config.port, options);
    client.onerror = (error: any) => console.error(error);
    await client.connect();
    return client;
  }

  private async getFoldersAsync(client: ImapClient): Promise<string[]> {
    const folders = await client.listMailboxes();
    const inbox = folders.children.find(folder => folder.name === "INBOX");
    if (!inbox) {
      throw Error("INBOX not found");
    }
    const received = inbox.children.find(folder => folder.name === "Received");
    if (!received) {
      throw Error("Received not found");
    }
    const subfolders = received.children.map(folder => folder.name.toLowerCase());
    return subfolders;
  }
  
  private async getMailAsync(client: ImapClient): Promise<any> {
    const header = "header.fields (envelope-to)";
    const messages = await client.listMessages("INBOX", `1:*`, ["uid", `BODY.PEEK[${header}]`], { byUid: true });
    const getFolder = (header: string) => {
      const matches = /\s([^@]+)/i.exec(header);
      if (!matches) {
        return header;
      }
      return matches[1].toLowerCase();
    };
    const output = messages.map(message => ({
      uid: message.uid,
      to: getFolder(message["body[header.fields (envelope-to)]"]),
    }));
    return output;
  }

  private async createFolderAsync(client: ImapClient, folder: string): Promise<void> {
    const fullfolder = `INBOX.Received.${folder}`;
    await client.createMailbox(fullfolder);
  }

  private async moveMailAsync(client: ImapClient, uid: string, toFolder: string) {
    await client.moveMessages("INBOX", uid, `INBOX.Received.${toFolder}`, { byUid: true })
  }

  private async scanInboxAsync(client: ImapClient) {
    const folders = await this.getFoldersAsync(client);
    const mails = await this.getMailAsync(client);
    for(let mail of mails) {
      if (!(mail.to in folders)) {
        await this.createFolderAsync(client, mail.to);
        folders.push(mail.to);
      }

      await this.moveMailAsync(client, mail.uid, mail.to);
    }
  }

  async runAsync() {
    const client = await this.connectAsync();
    try {
      await this.scanInboxAsync(client);
    } finally {
      await client.close();
    }
  }
}

new App().runAsync()
  .then(() => { })
  .catch((err) => console.error(err))