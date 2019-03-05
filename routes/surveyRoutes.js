const _ = require("lodash");
const Path = require("path-parser").default;
const { URL } = require("url");

const requireLogin = require("../middlewares/requireLogin");
const requireCredits = require("../middlewares/requireCredits");
const Mailer = require("../services/Mailer");
const surveyTemplate = require("../services/emailTemplates/surveyTemplate");
const Survey = require("../models/Survey");

module.exports = app => {
    app.get("/api/surveys", requireLogin, async (req, res) => {
        const surveys = await Survey.find({ _user: req.user.id }).select({
            recipients: false // exclude list of recipients
        });

        res.send(surveys);
    });

    app.get("/api/surveys/:surveyId/:choice", (req, res) => {
        res.send("Thanks for voting!");
    });

    app.post("/api/surveys/webhooks", (req, res) => {
        const p = new Path("/api/surveys/:surveyId/:choice"); // create object to help extract surveyId and choice
        // lodash chain function to combine multiple lodash functions together in cleaner way
        _.chain(req.body)
            // map over every event
            .map(({ email, url }) => {
                // extract just route portion of url, check if object contains surveyId and choice and assign to match
                const match = p.test(new URL(url).pathname);

                if (match) {
                    return {
                        email,
                        surveyId: match.surveyId,
                        choice: match.choice
                    };
                }
            })
            .compact() // return only events objects, removes elements that are undefined
            .uniqBy("email", "surveyId") // remove events with duplicate email and surveyId
            .each(({ surveyId, email, choice }) => {
                Survey.updateOne(
                    {
                        _id: surveyId,
                        recipients: {
                            $elemMatch: { email: email, responded: false }
                        }
                    },
                    {
                        $inc: { [choice]: 1 },
                        $set: { "recipients.$.responded": true },
                        lastResponded: new Date()
                    }
                ).exec();
            })
            .value(); // result of the chain

        res.send({});
    });

    app.post("/api/surveys", requireLogin, requireCredits, async (req, res) => {
        const { title, subject, body, recipients } = req.body;

        const survey = new Survey({
            title,
            subject,
            body,
            recipients: recipients
                .split(",")
                .map(email => ({ email: email.trim() })),
            _user: req.user.id,
            dateSent: Date.now()
        });

        // Great place to send an email!
        const mailer = new Mailer(survey, surveyTemplate(survey));

        try {
            await mailer.send();
            await survey.save();
            req.user.credits -= 1;
            const user = await req.user.save();

            res.send(user);
        } catch (err) {
            res.status(422).send(err);
        }
    });
};
