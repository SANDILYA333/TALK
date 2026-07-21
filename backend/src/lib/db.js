import mongoose from "mongoose"

export async function connectDB(){
    try{
        const mongoUri=process.env.MONGO_URI //mongoUri is having ur URI 

        if(!mongoUri){
            throw new Error("Mongo_Uri is required")
        }
        const connection = await mongoose.connect(mongoUri);
        console.log("MongoDB connection successful:", connection.connection.host);
    }catch(error){
        console.error("MongoDB connection failed: ",error.message);
        process.exit(1);
    }
}