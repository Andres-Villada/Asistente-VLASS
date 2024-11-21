import { createBot, createProvider, createFlow, addKeyword, utils, EVENTS} from '@builderbot/bot'
import { PostgreSQLAdapter as Database } from '@builderbot/database-postgres'
import { BaileysProvider as Provider } from '@builderbot/provider-baileys'
import { delay, downloadMediaMessage } from '@whiskeysockets/baileys'
import { writeFile } from 'fs/promises'
import { config } from 'dotenv'
config()
import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import { Context } from 'vm';
import pg from 'pg';
const { Pool } = pg;

const PORT = process.env.PORT ?? 3008

function getExtension(mimeType) {
    if (!mimeType || typeof mimeType !== 'string' || !mimeType.includes('/')) { return 'unknown' }
    const parts = mimeType.split('/');
    if (parts.length === 2) {
        let extension = parts[1];
        if (extension.endsWith('.sheet')) { extension = 'xlsx' }
        else if (extension.endsWith('.document')) { extension = 'docx' }
        else if (extension.endsWith('.presentation')) { extension = 'pptx' }
        return extension
    } else { return 'unknown' }

}

const FLASK_SERVER_URL = 'http://127.0.0.1:5000';



// Define la función obtenerNombreClase
async function obtenerNombreClase(numeroClase: number): Promise<string> {
    // Función para obtener la descripción de la clase desde la base de datos
    const pool = new Pool({
        host: 'localhost',
        user: 'postgres',
        database: 'bot',
        password: '12345',
        port: 5432
    });

    try {
        const client = await pool.connect();
        const result = await client.query('SELECT descripcion FROM public."Stories" where id = $1', [numeroClase]);

        if (result.rows.length > 0) {
            return result.rows[0].descripcion;
        } else {
            return `No se encontró ninguna descripción para la clase ${numeroClase}`;
        }
    } catch (error) {
        console.error('Error al consultar la base de datos:', error);
        return 'Error al consultar la base de datos';
    } finally {
        pool.end();
    }
}

const userStates = {}; // Objeto para almacenar el estado de cada usuario

const FlowFoto = addKeyword<Provider, Database>(['Foto', 'Fot'])
    .addAction(async (_, { flowDynamic }: Context) => {
        return await flowDynamic('Envía una fotografía de la que tengas curiosidad de una historia');
    })
    .addAction(async (_, { provider, flowDynamic }) => {
        provider.vendor.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            const userId = m.key.remoteJid;
            if (!m.message) return;

            // Identifica el tipo de mensaje
            const messageType = Object.keys(m.message)[0];
            if (messageType === 'imageMessage' && (!userStates[userId] || !userStates[userId].hasResponded)) {
                // Establece el estado como "respondido" para este usuario
                userStates[userId] = { hasResponded: true };


                // Maneja el mensaje de imagen
                const buffer = await downloadMediaMessage(m, 'buffer', {}, {
                    reuploadRequest: provider.vendor.updateMediaMessage,
                    logger: undefined,
                });

                // Procesa la imagen y la envía al servidor Flask
                const fileName = `imagen.${getExtension(m.message.imageMessage.mimetype)}`;
                await writeFile(`./src/downloadMediaMessage/media/${fileName}`, buffer);

                const formData = new FormData();
                formData.append('imagen', fs.createReadStream(`./src/downloadMediaMessage/media/${fileName}`));

                const response = await axios.post(`${FLASK_SERVER_URL}`, formData, {
                    headers: formData.getHeaders(),
                });

                // Obtiene la respuesta y envía la descripción al usuario
                const numeroClase = response.data.y;
                const nombreClase = await obtenerNombreClase(numeroClase);
                await provider.vendor.sendMessage(userId, { text: nombreClase });
                
                // Solicita otra imagen o terminación al usuario
                await provider.vendor.sendMessage(userId, {
                    text: `¿Quieres enviar otra imagen? Si es así, simplemente envía la imagen. De lo contrario, escribe *Terminar*.`
                });

                // Restablece el estado después de un pequeño tiempo, permitiendo nuevas imágenes
                setTimeout(() => {
                    userStates[userId].hasResponded = false;
                }, 2000); 
            }
        });

        // Maneja los mensajes de texto "terminar" y "encuestas"
        provider.vendor.ev.on('messages.upsert', async ({ messages }) => {
            const m = messages[0];
            const userId = m.key.remoteJid;
            if (!m.message) return;

            const textMessage = m.message.conversation?.toLowerCase();
            // Verifica si el mensaje es "terminar"
if (textMessage === 'terminar' && (!userStates[userId] || !userStates[userId].hasResponded)) {
    // Establece el estado como "respondido" para este usuario
    userStates[userId] = { hasResponded: true };
    await provider.vendor.sendMessage(userId, {
        text: 'Ha sido un placer guiarte por el Santuario de Las Lajas y compartir contigo su historia, significado y datos curiosos. Espero que esta experiencia te haya acercado a la magia de este lugar sagrado y te haya inspirado. \n\nSi pudieras ayudarme completando unas breves encuestas para mejorar nuestro servicio, te lo agradecería mucho. Solo escribe la palabra *encuestas* y te enviaré la información. ¡Gracias por tu colaboración! 🌟'
    });
    
    // Limpia el estado del usuario después de un tiempo
    setTimeout(() => {
        userStates[userId].hasResponded = false;
    }, 2000); 

// Verifica si el mensaje es "encuestas"
} else if (textMessage === 'encuestas' && (!userStates[userId] || !userStates[userId].hasResponded)) {
    // Establece el estado como "respondido" para este usuario
    userStates[userId] = { hasResponded: true };
    const encuestas = '¡Gracias por tu disposición! 😊 A continuación te envío las encuestas en orden: \n\n*Encuesta general sobre el Santuario de Las Lajas:* \nhttps://forms.gle/qqTJUmVVHWSZzAPDA \nNos ayudará a saber cuánto conocías sobre el santuario. \n\n*Encuesta antes de usarme como asistente virtual:* \nhttps://forms.gle/fZhMFevHreeWULti6 \nQueremos saber cómo fue tu experiencia antes de interactuar conmigo. \n\n*Encuesta después de usarme:* \nhttps://forms.gle/rC6FzZ3tdg26q7yLA \nNos permitirá evaluar cómo fue tu experiencia tras interactuar conmigo y si notaste alguna mejora. \n\nMuchas gracias por tu tiempo. \n🌟 ¡Tu participación es muy valiosa! 🌟';
    await provider.vendor.sendMessage(userId, { text: encuestas });
    
    // Registra el comando "encuestas" para evitar respuestas duplicadas
    userStates[userId] = { ...userStates[userId], lastCommand: 'encuestas' };
    
    // Limpia el estado del usuario después de un tiempo
    setTimeout(() => {
        userStates[userId].hasResponded = false;
    }, 2000); 
}

        });
    });


    

    const flowDocs = addKeyword(['doc', 'documentacion', 'documentación']).addAnswer(
        [
            '📄 Aquí encontras la documentación',
            'LINK',
            
        ],
        null,
        null,
    )
    
    const flowGracias = addKeyword(['gracias', 'grac']).addAnswer(
        [
            'Ha sido un placer guiarte por el Santuario de Las Lajas',
            'y compartir contigo su historia, significado y datos curiosos. ',
            'Espero que esta experiencia te haya acercado a la magia de este lugar sagrado y te haya inspirado a conocerlo en persona.',
            '\nRecuerda que el Asistente Virtual del Santuario de Las Lajas siempre estará aquí para ayudarte a descubrir más sobre este maravilloso lugar.'
        ],
        null,
        null,
    )

    const flowPrincipal = addKeyword<Provider, Database>(['Hola'])
    .addAnswer('🙌 Hola soy el asistente virtual VLASS y te brindare información acerca de la historia de algunos lugares del Santuario de las Lajas.')
    .addAnswer(
        [
            'Te comparto los siguientes links de interés sobre el proyecto.',
            'Digita una de las siguientes palabras que se encuentran en negrilla para realizar la acción que desees.',
            '👉 *Doc* para ver la documentación.',
            '👉 *Foto*  para enviar una foto y contarte una historia.',
            '👉 *Gracias*  para finalizar el chat.'

        ],
        null,
        null,
        [flowDocs, flowGracias,FlowFoto]
    )
const main = async () => {
    const adapterFlow = createFlow([flowPrincipal,flowDocs, flowGracias,FlowFoto])
    const adapterProvider = createProvider(Provider)
    const adapterDB = new Database({
       host: 'localhost',
       user: 'postgres',
       database: 'bot',
       password: '12345',
       port: +'5432'

   })

    const { handleCtx, httpServer } = await createBot({
        flow: adapterFlow,
        provider: adapterProvider,
        database: adapterDB,
    })

    adapterProvider.server.post(
        '/v1/messages',
        handleCtx(async (bot, req, res) => {
            const { number, message, urlMedia } = req.body
            await bot.sendMessage(number, message, { media: urlMedia ?? null })
            return res.end('sended')
        })
    )

    adapterProvider.server.post(
        '/v1/register',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('REGISTER_FLOW', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/samples',
        handleCtx(async (bot, req, res) => {
            const { number, name } = req.body
            await bot.dispatch('SAMPLES', { from: number, name })
            return res.end('trigger')
        })
    )

    adapterProvider.server.post(
        '/v1/blacklist',
        handleCtx(async (bot, req, res) => {
            const { number, intent } = req.body
            if (intent === 'remove') bot.blacklist.remove(number)
            if (intent === 'add') bot.blacklist.add(number)

            res.writeHead(200, { 'Content-Type': 'application/json' })
            return res.end(JSON.stringify({ status: 'ok', number, intent }))
        })
    )

    httpServer(+PORT)
}

main()