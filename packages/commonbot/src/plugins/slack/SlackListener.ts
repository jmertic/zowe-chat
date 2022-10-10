/*
* This program and the accompanying materials are made available under the terms of the
* Eclipse Public License v2.0 which accompanies this distribution, and is available at
* https://www.eclipse.org/legal/epl-v20.html
*
* SPDX-License-Identifier: EPL-2.0
*
* Copyright Contributors to the Zowe Project.
*/

import { IMessageHandlerFunction, IMessageMatcherFunction } from '../../types';

import { CommonBot } from '../../CommonBot';
import Listener = require('../../Listener');
import SlackMiddleware = require('./SlackMiddleware');

class SlackListener extends Listener {

    // Constructor
    constructor(bot: CommonBot) {
        super(bot);

        this.listen = this.listen.bind(this);
    }

    // Run listener
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async listen(matcher: IMessageMatcherFunction, handler: IMessageHandlerFunction): Promise<void> {
        // Print start log
        this.logger.start(this.listen, this);

        try {
            // Check and set middleware
            let middleware = <SlackMiddleware>this.bot.getMiddleware();
            if (middleware === null) {
                middleware = new SlackMiddleware(this.bot);
                this.bot.setMiddleware(middleware);
                await middleware.run();
            }

            // Set matcher
            this.messageMatcher.addMatcher(matcher, handler);
        } catch (err) {
            // Print exception stack
            this.logger.error(this.logger.getErrorStack(new Error(err.name), err));
        } finally {
            // Print end log
            this.logger.end(this.listen, this);
        }
    }
}

export = SlackListener;
