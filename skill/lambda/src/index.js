'use strict';

const Alexa = require("ask-sdk");
const axios = require("axios");
const Jsona = require("jsona");
const util = require("util");
const Kitsu = require("kitsu/node");
const Superagent = require('superagent');

const pco = axios.create({
    baseURL: 'https://api.planningcenteronline.com/services/v2/'
});

const api = new Kitsu({
    baseURL: 'https://api.planningcenteronline.com/services/v2/'
});

const superagent = Superagent.agent();

const jsona = new Jsona.Jsona();

async function updateAccessToken(accessToken) {
    pco.defaults.headers.common['Authorization'] = 'Bearer ' + accessToken;
    api.headers['Authorization'] =  'Bearer ' + accessToken;
    superagent.set('Authorization', 'Bearer ' + accessToken);
}

async function getCurrentUser() {
    try {
        const { body: user } = await superagent.get('https://api.planningcenteronline.com/services/v2/me');
        console.debug(util.format('getCurrentUser: %j', user));

        return user;

    } catch (e) {
        console.error(e);
    }
}

async function getUserFirstName() {
    try {
        const currentUser = await getCurrentUser();
        console.debug(util.format('getUserFirstName: %j', currentUser.first_name));

        if (currentUser.hasOwnProperty('first_name'))
            return currentUser.first_name;
        else
            return "";

    } catch (e) {
        console.error(e);
    }
}

async function getServiceTypes() {
    try {
        const { data: serviceTypes } = await api.get('/service_types');
        console.debug(util.format('getServiceTypes: %j', serviceTypes));

        return serviceTypes;

    } catch (e) {
        console.error(e);
    }
}

async function getMyPlans() {
    try {
        // fetch /me resource
        const currentUser = await getCurrentUser();

        // fetch plans
        const { data: plan_persons } = await api.fetch(currentUser.links.plan_people, {
            include: 'plan'
        });
        console.debug(util.format('getMyPlans: %s %j', currentUser.links.plan_people, plan_persons));

        let plans = {
            "confirmed": new Map(),
            "unconfirmed": new Map(),
            "declined": new Map()
        };
        for (var plan_person of plan_persons) {
            const plan_id = plan_person.plan.id;
            switch (plan_person.status) {
                case "C":
                    plans.confirmed.set(plan_id, plan_person.plan);
                    break;
                case "D":
                    plans.declined.set(plan_id, plan_person.plan);
                    break;
                case "U":
                default:
                    plans.unconfirmed.set(plan_id, plan_person.plan);
                    break;
            }
        }
        console.debug(util.format('getMyPlans: plans %j', plans));

        return plans;

    } catch (e) {
        console.error(e);
    }
}

async function getSongs(plans) {
    try {
        let all_attachments = new Set();
        for (var [id, plan] of plans) {

            let more = true;
            let url = plan.links.self + '/all_attachments?per_page=100';

            while(more) {

                console.log("fetching... " + url);
                const attachments = await pco.get(url);

                let data = await jsona.deserialize(attachments.data);
                let { links, meta } = await jsona.deserialize(attachments);

                for (let a of data) {
                    if (a.web_streamable) all_attachments.add(a);
                }

                if (links.next === undefined) {
                    more = false;
                }
                else {
                    url = links.next;
                }
            }
        }

        console.log(all_attachments);

        return all_attachments;

    } catch (e) {
        console.error(e);
    }
}

async function openStreamUrl(song_url) {
    // https://api.planningcenteronline.com/services/v2/service_types/[service_type_id]/plans/[plan_id]/all_attachments/[attachment_id]/open

    let attachment_activity = await pco.post(song_url);
    attachment_activity = jsona.deserialize(attachment_activity.data);

    return attachment_activity.attachment_url;
}

/* HANDLERS */

const LaunchRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'LaunchRequest';
    },
    async handle(handlerInput) {

        const { requestEnvelope, responseBuilder, attributesManager } = handlerInput;
        //
        // await updateAccessToken(requestEnvelope.context.System.user.accessToken);
        //
        // const firstName = await getUserFirstName();
        // const plans = await getMyPlans();
        //
        // const confirmedCount = plans.confirmed.size;
        // const unconfirmedOrDeclinedCount = plans.unconfirmed.size + plans.declined.size;
        //
        // const speechText = util.format(`Welcome to Planning Center %s! You have %s confirmed plans and %s unconfirmed or declined plans.`, firstName, confirmedCount, unconfirmedOrDeclinedCount);
        // const repromptText = 'You can ask me to play a song';
        //
        // return responseBuilder
        //     .speak(speechText)
        //     .reprompt(repromptText)
        //     .getResponse();

        const { playbackInfo, playlist } = await attributesManager.getPersistentAttributes();

        console.log(playbackInfo);
        console.log(playlist);
        await updateAccessToken(requestEnvelope.context.System.user.accessToken);
        const firstName = await getUserFirstName();

        let message;
        let reprompt;

        if (!playbackInfo.hasPreviousPlaybackSession) {
            message = `Welcome to Planning Center ${firstName}. You can ask me to play upcoming songs.`;
            reprompt = 'You can say, play my upcoming songs, to begin.';
        } else {
            playbackInfo.inPlaybackSession = false;
            const currentTitle = playlist[playbackInfo.playOrder[playbackInfo.index]].title;
            console.log(currentTitle);
            message = `You were listening to ${currentTitle}. Would you like to resume?`;
            reprompt = 'You can say yes to resume or no to play from the top.';
        }

        return handlerInput.responseBuilder
            .speak(message)
            .reprompt(reprompt)
            .getResponse();
    }
};

const AudioPlayerEventHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type.startsWith('AudioPlayer.');
    },
    async handle(handlerInput) {
        const { requestEnvelope, attributesManager, responseBuilder } = handlerInput;
        const { playbackSetting, playbackInfo, playlist } = await attributesManager.getPersistentAttributes();

        switch (requestEnvelope.request.type) {
            case 'AudioPlayer.PlaybackStarted':
                playbackInfo.token = getToken(handlerInput);
                playbackInfo.index = await getIndex(handlerInput);
                playbackInfo.inPlaybackSession = true;
                playbackInfo.hasPreviousPlaybackSession = true;
                break;
            case 'AudioPlayer.PlaybackFinished':
                playbackInfo.inPlaybackSession = false;
                playbackInfo.hasPreviousPlaybackSession = false;
                playbackInfo.nextStreamEnqueued = false;
                break;
            case 'AudioPlayer.PlaybackStopped':
                playbackInfo.token = getToken(handlerInput);
                playbackInfo.index = await getIndex(handlerInput);
                playbackInfo.offsetInMilliseconds = getOffsetInMilliseconds(handlerInput);
                break;
            case 'AudioPlayer.PlaybackNearlyFinished': {
                if (playbackInfo.nextStreamEnqueued) {
                    break;
                }

                const enqueueIndex = (playbackInfo.index + 1) % playlist.length;

                if (enqueueIndex === 0 && !playbackSetting.loop) {
                    break;
                }

                playbackInfo.nextStreamEnqueued = true;

                const enqueueToken = playbackInfo.playOrder[enqueueIndex];
                const playBehavior = 'ENQUEUE';
                const song = playlist[playbackInfo.playOrder[enqueueIndex]];
                const expectedPreviousToken = playbackInfo.token;
                const offsetInMilliseconds = 0;

                const url = await openStreamUrl(song.url);

                responseBuilder.addAudioPlayerPlayDirective(
                    playBehavior,
                    url,
                    enqueueToken,
                    offsetInMilliseconds,
                    expectedPreviousToken,
                );
                break;
            }
            case 'PlaybackFailed':
                playbackInfo.inPlaybackSession = false;
                console.log('Playback Failed : %j', handlerInput.requestEnvelope.request.error);
                return;
            default:
                throw new Error('Should never reach here!');
        }

        return responseBuilder.getResponse();
    }
};

const StartPlaybackHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        if (!playbackInfo.inPlaybackSession) {
            return request.type === 'IntentRequest' && request.intent.name === 'PlayAudio';
        }
        if (request.type === 'PlaybackController.PlayCommandIssued') {
            return true;
        }

        if (request.type === 'IntentRequest') {
            return request.intent.name === 'PlayAudio'
                || request.intent.name === 'AMAZON.ResumeIntent';
        }
    },
    handle(handlerInput) {
        return controller.play(handlerInput);
    }
};

const NextPlaybackHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && (request.type === 'PlaybackController.NextCommandIssued'
            || (request.type === 'IntentRequest' && request.intent.name === 'AMAZON.NextIntent'));
    },
    handle(handlerInput) {
        return controller.playNext(handlerInput);
    }
};

const PreviousPlaybackHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && (request.type === 'PlaybackController.PreviousCommandIssued'
            || (request.type === 'IntentRequest' && request.intent.name === 'AMAZON.PreviousIntent'));
    },
    handle(handlerInput) {
        return controller.playPrevious(handlerInput);
    }
};

const PausePlaybackHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && (request.intent.name === 'AMAZON.StopIntent'
            || request.intent.name === 'AMAZON.CancelIntent'
            || request.intent.name === 'AMAZON.PauseIntent');
    },
    handle(handlerInput) {
        return controller.stop(handlerInput);
    }
};

const LoopOnHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.LoopOnIntent';
    },
    async handle(handlerInput) {
        const playbackSetting = await handlerInput.attributesManager.getPersistentAttributes().playbackSetting;

        playbackSetting.loop = true;

        return handlerInput.responseBuilder
            .speak('Loop turned on.')
            .getResponse();
    }
};

const LoopOffHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.LoopOffIntent';
    },
    async handle(handlerInput) {
        const playbackSetting = await handlerInput.attributesManager.getPersistentAttributes().playbackSetting;

        playbackSetting.loop = false;

        return handlerInput.responseBuilder
            .speak('Loop turned off.')
            .getResponse();
    }
};

const ShuffleOnHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.ShuffleOnIntent';
    },
    async handle(handlerInput) {
        const { playbackInfo, playbackSetting } = await handlerInput.attributesManager.getPersistentAttributes();

        playbackSetting.shuffle = true;
        playbackInfo.playOrder = await shuffleOrder();
        playbackInfo.index = 0;
        playbackInfo.offsetInMilliseconds = 0;
        playbackInfo.playbackIndexChanged = true;

        return controller.play(handlerInput);
    },
};

const ShuffleOffHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.ShuffleOffIntent';
    },
    async handle(handlerInput) {
        const { playbackInfo, playbackSetting, playlist } = await handlerInput.attributesManager.getPersistentAttributes();

        if (playbackSetting.shuffle) {
            playbackSetting.shuffle = false;
            playbackInfo.index = playbackInfo.playOrder[playbackInfo.index];
            playbackInfo.playOrder = [...Array(playlist.length).keys()];
        }

        return controller.play(handlerInput);
    },
};

const StartOverHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && request.intent.name === 'AMAZON.StartOverIntent';
    },
    async handle(handlerInput) {

        await handlerInput.attributesManager.setPersistentAttributes(defaultAttributes);

        const message = 'Welcome to Planning Center. You can say, play my upcoming songs.';

        return handlerInput.responseBuilder
            .speak(message)
            .reprompt(message)
            .getResponse();
    }
};

const YesHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return !playbackInfo.inPlaybackSession && request.type === 'IntentRequest' && request.intent.name === 'AMAZON.YesIntent';
    },
    handle(handleInput) {
        return controller.play(handleInput);
    }
};

const NoHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;

        return !playbackInfo.inPlaybackSession && request.type === 'IntentRequest' && request.intent.name === 'AMAZON.NoIntent';
    },
    async handle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);

        playbackInfo.index = 0;
        playbackInfo.offsetInMilliseconds = 0;
        playbackInfo.playbackIndexChanged = true;
        playbackInfo.hasPreviousPlaybackSession = false;

        return controller.play(handlerInput);
    }
};

const HelpHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'AMAZON.HelpIntent';
    },
    async handle(handlerInput) {
        const { playbackInfo, playlist } = await attributesManager.getPersistentAttributes();
        let message;

        if (!playbackInfo.hasPreviousPlaybackSession) {
            message = 'Welcome to Planning Center. You can say, play my upcoming songs.';
        } else if (!playbackInfo.inPlaybackSession) {
            message = `You were listening to ${playlist[playbackInfo.index].title}. Would you like to resume?`;
        } else {
            message = 'You are listening to song on Planning Center. You can say, Next or Previous to navigate through the playlist. At any time, you can say Pause to pause the audio and Resume to resume.';
        }

        return handlerInput.responseBuilder
            .speak(message)
            .reprompt(message)
            .getResponse();
    },
};

const ExitHandler = {
    async canHandle(handlerInput) {
        const playbackInfo = await getPlaybackInfo(handlerInput);
        const request = handlerInput.requestEnvelope.request;


        return !playbackInfo.inPlaybackSession
            && request.type === 'IntentRequest'
            && (request.intent.name === 'AMAZON.StopIntent'
            || request.intent.name === 'AMAZON.CancelIntent');
    },
    handle(handlerInput) {
        return handlerInput.responseBuilder
            .speak('Goodbye!')
            .getResponse();
    }
};

const SystemExceptionHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'System.ExceptionEncountered';
    },
    handle(handlerInput) {
        console.log(`System exception encountered: ${handlerInput.requestEnvelope.request.reason}`);
    }
};

const SessionEndedRequestHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'SessionEndedRequest';
    },
    handle(handlerInput) {
        console.log(`Session ended with reason: ${handlerInput.requestEnvelope.request.reason}`);

        // cleanup logic goes here
        return handlerInput.responseBuilder.getResponse();
    }
};

const ErrorHandler = {
    canHandle() {
        return true;
    },
    handle(handlerInput, error) {
        console.log(`Error handled: ${error.message}`);
        const message = 'Sorry, this is not a valid command. Please say help to hear what you can say.';

        return handlerInput.responseBuilder
            .speak(message)
            .reprompt(message)
            .getResponse();
    }
};

/* --- */

const PlaySingleSongIntent = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'PlaySingleSongIntent';
    },
    async handle(handlerInput) {
        const { requestEnvelope, attributesManager, responseBuilder } = handlerInput;

        const songTitle = requestEnvelope.request.intent.slots.songTitle.value;

        return responseBuilder
            .speak(`I didn't find any songs matching ${songTitle}. What's the name of a song you'd like to hear?`)
            .reprompt(`I can match on part of the title as well.`)
            .getResponse();

    },
};

const PlaySongsIntentHandler = {
    canHandle(handlerInput) {
        return handlerInput.requestEnvelope.request.type === 'IntentRequest'
            && handlerInput.requestEnvelope.request.intent.name === 'PlaySongsIntent';
    },
    async handle(handlerInput) {

        const { attributesManager, requestEnvelope } = handlerInput;

        await updateAccessToken(requestEnvelope.context.System.user.accessToken);

        // read the current session attributes and create them if they don't exist
        const { playbackInfo, playlist } = await attributesManager.getPersistentAttributes();

        const plans = await getMyPlans();
        const songs = await getSongs(plans.confirmed);

        for (let song of songs) {
            playlist.push({
                title: song.filename,
                url: song.links.self + "/open"
            });
        }
        playbackInfo.playOrder = await shuffleOrder(playlist);

        console.log(playlist);

        //const speechText = util.format(`I found %s songs from your upcoming plans.`, songs.size);

        return controller.play(handlerInput);
    }
};


/* INTERCEPTORS */

const defaultAttributes = {
    playbackSetting: {
        loop: false,
        shuffle: false,
    },
    playbackInfo: {
        playOrder: [],
        index: 0,
        offsetInMilliseconds: 0,
        playbackIndexChanged: true,
        token: '',
        nextStreamEnqueued: false,
        inPlaybackSession: false,
        hasPreviousPlaybackSession: false,
    },
    playlist: []
};

const LoadPersistentAttributesRequestInterceptor = {
    async process(handlerInput) {
        const persistentAttributes = await handlerInput.attributesManager.getPersistentAttributes();

        // Check if user is invoking the skill the first time and initialize preset values
        if (Object.keys(persistentAttributes).length === 0) {
            handlerInput.attributesManager.setPersistentAttributes(defaultAttributes);
        }
    },
};

const SavePersistentAttributesResponseInterceptor = {
    async process(handlerInput) {
        await handlerInput.attributesManager.savePersistentAttributes();
    },
};

/* HELPERS */

async function getPlaybackInfo(handlerInput) {
    const attributes = await handlerInput.attributesManager.getPersistentAttributes();
    return attributes.playbackInfo;
}

const controller = {
    async play(handlerInput) {
        const { attributesManager, responseBuilder } = handlerInput;
        const { playbackInfo, playbackSetting, playlist } = await attributesManager.getPersistentAttributes();

        console.log(playlist);
        const playBehavior = 'REPLACE_ALL';
        const song = playlist[playbackInfo.playOrder[playbackInfo.index]];
        const token = playbackInfo.playOrder[playbackInfo.index];

        console.log(playbackInfo.playOrder);
        console.log(playbackInfo.index);
        console.log(song);

        const url = await openStreamUrl(song.url);

        responseBuilder
            .speak(`This is ${song.title}`)
            .withShouldEndSession(true)
            .addAudioPlayerPlayDirective(playBehavior, url, token, playbackInfo.offsetInMilliseconds, null);

        return responseBuilder.getResponse();
    },
    stop(handlerInput) {
        return handlerInput.responseBuilder
            .addAudioPlayerStopDirective()
            .getResponse();
    },
    async playNext(handlerInput) {
        const {
            playbackInfo,
            playbackSetting,
            playlist
        } = await handlerInput.attributesManager.getPersistentAttributes();

        const nextIndex = (playbackInfo.index + 1) % playlist.length;

        if (nextIndex === 0 && !playbackSetting.loop) {
            return handlerInput.responseBuilder
                .speak('You have reached the end of the playlist')
                .addAudioPlayerStopDirective()
                .getResponse();
        }

        playbackInfo.index = nextIndex;
        playbackInfo.offsetInMilliseconds = 0;
        playbackInfo.playbackIndexChanged = true;

        return this.play(handlerInput);
    },
    async playPrevious(handlerInput) {
        const {
            playbackInfo,
            playbackSetting,
            playlist
        } = await handlerInput.attributesManager.getPersistentAttributes();

        let previousIndex = playbackInfo.index - 1;

        if (previousIndex === -1) {
            if (playbackSetting.loop) {
                previousIndex += playlist.length;
            } else {
                return handlerInput.responseBuilder
                    .speak('You have reached the start of the playlist')
                    .addAudioPlayerStopDirective()
                    .getResponse();
            }
        }

        playbackInfo.index = previousIndex;
        playbackInfo.offsetInMilliseconds = 0;
        playbackInfo.playbackIndexChanged = true;

        return this.play(handlerInput);
    },
};

function getToken(handlerInput) {
    // Extracting token received in the request.
    return handlerInput.requestEnvelope.request.token;
}

async function getIndex(handlerInput) {
    // Extracting index from the token received in the request.
    const tokenValue = parseInt(handlerInput.requestEnvelope.request.token, 10);
    const attributes = await handlerInput.attributesManager.getPersistentAttributes();

    return attributes.playbackInfo.playOrder.indexOf(tokenValue);
}

function getOffsetInMilliseconds(handlerInput) {
    // Extracting offsetInMilliseconds received in the request.
    return handlerInput.requestEnvelope.request.offsetInMilliseconds;
}

function shuffleOrder(playlist) {
    const array = [...Array(playlist.length).keys()];
    let currentIndex = array.length;
    let temp;
    let randomIndex;
    // Algorithm : Fisher-Yates shuffle
    return new Promise((resolve) => {
        while (currentIndex >= 1) {
            randomIndex = Math.floor(Math.random() * currentIndex);
            currentIndex -= 1;
            temp = array[currentIndex];
            array[currentIndex] = array[randomIndex];
            array[randomIndex] = temp;
        }
        resolve(array);
    });
}

const skillBuilder = Alexa.SkillBuilders.standard();

exports.handler = skillBuilder
    .addRequestHandlers(
        LaunchRequestHandler,
        HelpHandler,
        SystemExceptionHandler,
        SessionEndedRequestHandler,
        YesHandler,
        NoHandler,
        StartPlaybackHandler,
        NextPlaybackHandler,
        PreviousPlaybackHandler,
        PausePlaybackHandler,
        LoopOnHandler,
        LoopOffHandler,
        ShuffleOnHandler,
        ShuffleOffHandler,
        StartOverHandler,
        ExitHandler,
        AudioPlayerEventHandler,
        PlaySingleSongIntent,
        PlaySongsIntentHandler
    )
    .addRequestInterceptors(LoadPersistentAttributesRequestInterceptor)
    .addResponseInterceptors(SavePersistentAttributesResponseInterceptor)
    .addErrorHandlers(ErrorHandler)
    .withAutoCreateTable(true)
    .withTableName('pco-skill-db')
    .lambda();