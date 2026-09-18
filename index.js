require('dotenv').config();
const Replicate = require("replicate");
const OpenAI = require("openai");
const express = require('express');
const { syncSanity } = require('./sanity');
const cors = require('cors')
const mysql = require('mysql2');
const app = express();
const port = 3000;
const { v4: uuidv4 } = require('uuid');

// CORS
app.use(cors());


// -------------------------------
// CHANGING NATURES DATABASE
// -------------------------------

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME
});

const promisePool = pool.promise();

const REFERENCE_FIELDS = ['topics', 'rawMaterials', 'processedMaterials', 'practices', 'emotions'];

/**
 * Fetches associated data for a given field from the `open_list_values` table.
 * @async
 * @function
 * @param {Object} data - The data object that contains the field for which associated data should be fetched.
 * @param {string} field - The field name within the data object for which associated data is required.
 * @returns {Promise<Object>} The updated data object with the associated data for the specified field.
 * @throws {Error} Throws an error if there's a problem querying the database.
 */
async function getAssociatedData(data, field) {
    if (data[field] && data[field].length > 0) {
        // Use JOIN to get translations
        const [rows] = await promisePool.query(`
            SELECT olv.*, olt.language, olt.title as translated_title 
            FROM open_list_values olv
            LEFT JOIN open_list_values_translations olt ON olv.id = olt.open_list_value_id
            WHERE olv.id IN (?)
            AND olv.deleted_at IS NULL
        `, [data[field]]);

        // Organize the data and translations
        const organizedRows = rows.reduce((acc, curr) => {
            if (!acc[curr.id]) {
                acc[curr.id] = {
                    id: curr.id,
                    type: curr.type,
                    original_language: curr.original_language,
                    title: curr.title,
                    created_at: curr.created_at,
                    updated_at: curr.updated_at,
                    deleted_at: curr.deleted_at,
                    parent_id: curr.parent_id,
                    translations: {}
                };
            }
            if (curr.language && curr.translated_title) {
                acc[curr.id].translations[curr.language] = curr.translated_title;
            }
            return acc;
        }, {});

        data[field] = Object.values(organizedRows);
    }
    return data;
}

/**
 * Fetches associated events for a given participation ID and returns them in a formatted manner.
 * 
 * @async
 * @function
 * @param {string|number} participationId - The ID of the participation for which to fetch associated events.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of formatted event objects. Each object contains:
 */
async function getEvents(participationId) {
    // Fetch associated events for each participation
    const [events] = await promisePool.query('SELECT data, geodata, geocoding_data FROM events WHERE participation_id = ?', [participationId]);
    return events.map((event) => {
        const eventData = JSON.parse(event.data);
        return {
            _key: uuidv4(),
            title_fr: eventData.names.fr,
            title_en: eventData.names.en,
            title_de: eventData.names.de,
            startYear: eventData.startYear,
            endYear: eventData.endYear,
            geodata: event.geocoding_data || event.geodata,
        };
    });
}

/**
 * Fetches associated observations for a given participation ID and their related media records.
 * @async
 * @function
 * @param {string|number} participationId - The ID of the participation for which to fetch associated observations.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of observation objects. Each observation object includes:
 */
async function getObservations(participationId) {
    // Fetch the linked observations
    const [observations] = await promisePool.query('SELECT * FROM observations WHERE participation_id = ?', [participationId]);
    // Fetch the linked observation media and media records for each observation
    const observationPromises = observations.map(async (observation) => {
        const [observationMedia] = await promisePool.query('SELECT * FROM observations_medias WHERE observation_id = ?', [observation.id]);
        const mediaPromises = observationMedia.map(async (media) => {
            const [mediaRecord] = await promisePool.query('SELECT * FROM medias WHERE id = ?', [media.media_id]);
            media.mediaRecord = mediaRecord[0];
        });
        await Promise.all(mediaPromises);
        observation.observationMedia = observationMedia;
    });
    await Promise.all(observationPromises);
    return observations;
}

/**
 * Handles GET requests to fetch all participations.
 * @function
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {void}
 */
app.get('/participations', async (req, res) => {
    try {
        const [rows] = await promisePool.query('SELECT * FROM participations');
        res.json(rows);
    } catch (err) {
        console.error('An error occurred while retrieving data:', err);
        res.status(500).send('An error occurred while retrieving data.');
    }
});

/**
 * Handles GET requests to fetch all participations with embedded associated data, observations, and media.
 * @function
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {void}
 */
app.get('/participations/embedded', async (req, res) => {
    try {
        const [participations] = await promisePool.query('SELECT * FROM participations');

        // Fetch the associated data and linked observations and media for each participation
        const promises = participations.map(async (participation) => {
            const data = JSON.parse(participation.data);

            // Get associated data for relevant fields
            for (const field of REFERENCE_FIELDS) {
                participation.data = await getAssociatedData(data, field);
            }

            // Fetch linked observations
            participation.observations = await getObservations(participation.id);

            // Fetch associated events
            participation.events = await getEvents(participation.id)

            return participation;
        });

        const results = await Promise.all(promises);
        res.json(results);
    } catch (err) {
        console.error('An error occurred while retrieving data:', err);
        res.status(500).send('An error occurred while retrieving data.');
    }
});

/**
 * Handles GET requests to fetch a participation by its ID.
 * @function
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {void}
 */
app.get('/participations/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await promisePool.query('SELECT * FROM participations WHERE id = ?', [id]);
        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).send('No record found with the provided ID.');
        }
    } catch (err) {
        console.error('An error occurred while retrieving data:', err);
        res.status(500).send('An error occurred while retrieving data.');
    }
});

/**
 * Handles GET requests to fetch a single participation by its ID, embedding the associated data, observations, and media.
 * @function
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {void}
 */
app.get('/participations/:id/embedded', async (req, res) => {
    const { id } = req.params;

    try {
        const [rows] = await promisePool.query('SELECT * FROM participations WHERE id = ?', [id]);
        if (rows.length > 0) {
            const participation = rows[0];
            const data = JSON.parse(participation.data);

            // Get associated data for relevant fields
            for (const field of REFERENCE_FIELDS) {
                participation.data = await getAssociatedData(data, field);
            }

            // Fetch linked observations
            participation.observations = await getObservations(participation.id);

            // Fetch associated events
            participation.events = await getEvents(participation.id)

            res.json(participation);
        } else {
            res.status(404).send('No record found with the provided ID.');
        }
    } catch (err) {
        console.error('An error occurred while retrieving data:', err);
        res.status(500).send('An error occurred while retrieving data.');
    }
});

/**
 * Handles GET requests to fetch and synchronize participation data with associated observations, media, and events.
 * @function
 * @async
 * @param {Object} req - Express request object.
 * @param {Object} res - Express response object.
 * @returns {void}
 */
app.get('/sync', async (req, res) => {
    try {
        const [participations] = await promisePool.query('SELECT * FROM participations');

        const promises = participations.map(async (participation) => {
            // Get associated data for relevant fields
            const data = JSON.parse(participation.data);
            for (const field of REFERENCE_FIELDS) {
                participation.data = await getAssociatedData(data, field);
            }

            // Fetch linked observations
            participation.observations = await getObservations(participation.id);

            // Fetch associated events
            participation.events = await getEvents(participation.id)

            return participation;
        });

        const results = await Promise.all(promises);
        await syncSanity(results);
        res.json(results);
    } catch (err) {
        console.error('An error occurred while retrieving data:', err);
        res.status(500).send('An error occurred while retrieving data.');
    }
});

// -------------------------------
// OPEN AI
// -------------------------------

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

// -------------------------------
// REPLICATE
// -------------------------------

const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
});

const IMAGE_VERSION = '2a865c9a94c9992b6689365b75db2d678d5022505ed3f63a5f53929a31a46947'

let temp = null;

/**
 * Endpoint to generate predictions based on query parameters. Supports both text and image types.
 * 
 * @route GET /generate
 * @async
 * @param {Object} req - The Express request object containing query parameters.
 * @param {Object} res - The Express response object.
 * @returns {void}
 */
app.get('/generate', async (req, res) => {
    // Extract query parameters from the request
    const query = req.query;

    // Handle text-based predictions
    if (query.type === "text") {
        // Prepare input data for the prediction model
        const input = {
            prompt: query.prompt,
            system_prompt: query.system_prompt,
            temperature: parseFloat(query.temperature),
            model: query.model
        }
      
        // Create prediction
        const textCompletion = await openai.chat.completions.create({
            messages: [{ role: "system", content: input.system_prompt }, { role: "user", content: input.prompt }],
            model: input.model,
            temperature: input.temperature,
            max_completion_tokens:1024,
            reasoning_effort:"low",
            top_p:1,
            frequency_penalty:0,
            presence_penalty:0
        }).catch((err) => {
            // Error Handling
            if (err instanceof OpenAI.APIError) {
              console.error(err.status); // 400
              console.error(err.name); // BadRequestError
              console.error(err.headers); // {server: 'nginx', ...}
              console.error(err.message);
              throw new Error(err);
            } else {
              throw new Error(err);
            }
        });
        
        // Return result
        res.json({text: textCompletion.choices[0].message.content})


        // Handle image-based predictions
    } else if (query.type === "image") {
        // Prepare input data for the image prediction model
        const input = {
            prompt: query.prompt,
            negative_prompt: query.negative_prompt,
            width: parseInt(query.width),
            height: parseInt(query.height),
            num_inference_steps: 25
        };

        // Create a new image prediction using the input data
        let prediction = await replicate.predictions.create({
            version: IMAGE_VERSION,
            input: input,
            webhook: query.webhook
        });

        // Wait for the prediction to complete with periodic checks
        prediction = await replicate.wait(prediction, { interval: 250 });

        // Handle prediction errors
        if (prediction.error) {
            throw new Error(prediction.error);
        }

        // Extract and send the prediction output if available
        const output = prediction.output;
        if (output) {
            res.json({ output });
        }
    } else {
        res.status(400).send('Invalid prediction type.');
    }
});

/**
 * Endpoint to handle incoming webhooks. Processes the payload.
 * 
 * @route POST /webhook
 * @param {Object} req - The Express request object containing the webhook payload.
 * @param {Object} res - The Express response object.
 * @returns {void}
 */
app.post('/webhook', (req, res) => {
    // Extract the payload from the request body
    const payload = req.body;

    // Store the output in a temporary global variable
    temp = payload.output;

    // Respond to the webhook sender with a success status
    res.sendStatus(200).end();
});

// -------------------------------
// GENERAL
// -------------------------------

/**
 * Starts the Express application and listens for connections on a specified port.
 * @function
 */
app.listen(port, () => {
    console.log(`App listening at http://localhost:${port}`);
});

