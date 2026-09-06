import mongoose from "mongoose"

const userSchema = new mongoose.Schema({
    
    clerkId:{
        type:String,
        required:true,
        unique:true,
    },
    
    email:{
        type:String,
        unique:true,
        required:true,
    },

    fullName:{
        type:String,
        required:true,
    },

    profilePic:{
        type:String,
        default:"",
    },

    connectId:{
        type:String,
        unique:true,
        sparse:true,
        index:true,
        uppercase:true,
        trim:true,
    },
},{timestamps: true}
,);

const User = mongoose.model("User",userSchema)

export default User;