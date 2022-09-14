/*
* This program and the accompanying materials are made available under the terms of the
* Eclipse Public License v2.0 which accompanies this distribution, and is available at
* https://www.eclipse.org/legal/epl-v20.html
*
* SPDX-License-Identifier: EPL-2.0
*
* Copyright Contributors to the Zowe Project.
*/

import { IChatListenerRegistryEntry, IMessageListener } from '../types';

import _ from "lodash";

import { IChatContextData, IChatToolType, IMessageType, IPayloadType } from '@zowe/commonbot';
import { MessagingApp } from '../bot/MessagingApp';
import { AppConfig } from '../config/base/AppConfig';
import { SecurityManager } from '../security/SecurityManager';
import { Logger } from '../utils/Logger';
import Util from "../utils/Util";
import { BotListener } from './BotListener';

export class BotMessageListener extends BotListener {

    private chatListeners: IChatListenerRegistryEntry[];
    private readonly botName: string;
    private readonly log: Logger
    private readonly config: AppConfig
    private readonly securityFacility: SecurityManager;
    private readonly webapp: MessagingApp

    constructor(config: AppConfig, securityFac: SecurityManager, webapp: MessagingApp, log: Logger) {
        super();
        this.webapp = webapp
        switch (config.app.chatToolType) {
            case IChatToolType.MATTERMOST:
                this.botName = config.mattermost.botUserName
                break;
            case IChatToolType.MSTEAMS:
                this.botName = config.msteams.botUserName
                break;
            case IChatToolType.SLACK:
                this.botName = config.slack.botUserName
                break;
        }
        this.chatListeners = [];
        this.config = config;
        this.log = log;
        this.securityFacility = securityFac;
        this.matchMessage = this.matchMessage.bind(this);
        this.processMessage = this.processMessage.bind(this);
    }

    // Register Zowe chat listener
    registerChatListener(listenerEntry: IChatListenerRegistryEntry): void {
        // Print start log
        this.log.start(this.registerChatListener, this);

        // Register listener
        this.log.info(`Listener: ${listenerEntry.listenerName}    Type: ${listenerEntry.listenerType}    `
            + `Plugin: ${listenerEntry.chatPlugin.package}    Version: ${listenerEntry.chatPlugin.version}    Priority: ${listenerEntry.chatPlugin.priority}`);
        this.chatListeners.push(listenerEntry);

        // Print end log
        this.log.end(this.registerChatListener, this);
    }

    // Get chat listener
    getChatListener(): IChatListenerRegistryEntry[] {
        return this.chatListeners;
    }

    // Match inbound message
    matchMessage(chatContextData: IChatContextData): boolean {
        // Print start log
        this.log.start(this.matchMessage, this);

        try {
            // Initialize listener and context pool
            const listeners: IChatListenerRegistryEntry[] = [];
            const contexts: IChatContextData[] = [];

            // Match the bot name


            if ((<string>chatContextData.payload.data).indexOf(`@${this.botName}`) === -1) {
                this.log.debug(`Received message is not for @${this.botName}, ignoring.`);
            } else {
                if (chatContextData.payload.type === IPayloadType.MESSAGE) {
                    // Find matched listeners
                    for (const listener of this.chatListeners) {
                        const contextData: IChatContextData = _.cloneDeep(chatContextData);
                        if (contextData.extraData === undefined || contextData.extraData === null) {
                            contextData.extraData = {
                                'chatPlugin': listener.chatPlugin,
                            };
                        } else {
                            contextData.extraData.chatPlugin = listener.chatPlugin;
                        }
                        if ((<IMessageListener>listener.listenerInstance).matchMessage(contextData)) {
                            listeners.push(listener);
                            contexts.push(contextData);
                        }
                    }
                } else {
                    this.log.error(`Wrong payload type: ${chatContextData.payload.type}`);
                }

                // Set listener and context pool
                if (chatContextData.extraData === undefined || chatContextData.extraData === null) {
                    chatContextData.extraData = {
                        'listeners': listeners,
                        'contexts': contexts,
                    };
                } else {
                    chatContextData.extraData.listeners = listeners;
                    chatContextData.extraData.contexts = contexts;
                }
                this.log.info(`${chatContextData.extraData.listeners.length} of ${this.chatListeners.length} registered listeners can handle the message!`);
                this.log.debug(`Matched listeners:\n${Util.dumpObject(chatContextData.extraData.listeners, 2)}`);
            }

            // Set return result
            if (listeners.length > 0) {
                return true;
            } else {
                return false;
            }
        } catch (error) {
            // Print exception stack
            //this.log.error(this.log.getErrorStack(new Error(error.name), error));
            this.log.error(error)
        } finally {
            // Print end log
            this.log.end(this.matchMessage, this);
        }
    }

    // Process matched message
    async processMessage(chatContextData: IChatContextData): Promise<void> {
        // Print start log
        this.log.start(this.processMessage, this);
        let user = chatContextData.context.chatting.user

        if (!this.securityFacility.isAuthenticated(chatContextData)) {
            let redirect = this.webapp.generateChallenge(user)
            this.log.debug("Creating challenge link " + redirect + " for user " + user.name)

            await chatContextData.context.chatting.bot.send(chatContextData.extraData.contexts[0], [{
                message: `Hello @${user.name}, you are not currently logged in to the backend system. Please visit ${redirect} to login`,
                type: IMessageType.PLAIN_TEXT
            }])
            this.log.end(this.processMessage, this);
        }

        else {
            try {

                let principal = this.securityFacility.getPrincipal(this.securityFacility.getChatUser(chatContextData))
                /*      if (principal == undefined) {
                          let redirect = this.webapp.generateChallenge(user)
      
                          await chatContextData.context.chatting.bot.send(chatContextData.extraData.contexts[0], [{
                              message: `Hello @${user.name}, your login expired. Please visit ${redirect} to login again,`,
                              type: IMessageType.PLAIN_TEXT
                          }])
                          this.log.end(this.processMessage, this);
                          return
                      }*/

                // Get matched listener and contexts
                const matchedListeners: IChatListenerRegistryEntry[] = chatContextData.extraData.listeners;
                const listenerContexts: IChatContextData[] = chatContextData.extraData.contexts;

                // Get the number of plugin limit
                let pluginLimit = this.config.app.pluginLimit;
                this.log.info(`pluginLimit: ${pluginLimit}`);
                if (pluginLimit < 0 || pluginLimit > matchedListeners.length) {
                    pluginLimit = matchedListeners.length;
                }
                this.log.info(`${pluginLimit} of ${matchedListeners.length} matched listeners will response to the matched message!`);
                // Process matched messages
                for (let i = 0; i < pluginLimit; i++) {
                    // Process message

                    const msgs = await (<IMessageListener>matchedListeners[i].listenerInstance).processMessage(listenerContexts[i]);
                    this.log.debug(`Message sent to channel: ${JSON.stringify(msgs, null, 2)}`);

                    // Send response
                    await chatContextData.context.chatting.bot.send(listenerContexts[i], msgs);
                }
            } catch (error) {
                // Print exception stack
                // this.log.error(this.log.getErrorStack(new Error(error.name), error));
                this.log.error(error)
            } finally {
                // Print end log
                this.log.end(this.processMessage, this);
            }

        }
    }

}