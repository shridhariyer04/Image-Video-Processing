import winston from 'winston';

const {combine, timestamp, printf, colorize} = winston.format;

//Define csutom log format wit timestamp and colors

const logFormat = printf(({level,message,timstamp}) =>{
    return `${timestamp} [${level}]:${message}`;
});

const logger = winston.createLogger({
    level:process.env.LOG_LEVEL || 'info',
    format:combine(
        colorize(),
        timestamp({format:'YYY-MM DD HH:mm:ss'}),
        logFormat
    ),
    transports:[
        new winston.transports.Console()
    ]
})

export default logger;