import express from "express"

import cors from "cors";

import "dotenv/config"
import fd from "fs"
import path from "path"

import User from "./models/user.model.js"

import { connectDB } from "./lib/db.js"

import {clerkMiddleware} from "@clerk/express"

const app =express()
const PORT = process.env.PORT
const FRONTEND_URL= process.env.FRONTEND_URL; 

const publicDir=path.join(process.cwd(),"public");

app.use(express.json()) //parse the client side message

app.use(cors({origin:FRONTEND_URL,credentials:true}))

app.use(clerkMiddleware())

app.get("/health",(req,res)=>{
    res.status(200).json({ok:true})
})

if(fs.existSync(publicDir)){
    app.use(express.static(publicDir));

    app.get("/{*any}",(req,res,next)=>{
        res.sendFile(path,join(publicDir,"index.html"),(err)=>next(err));
    });
}

app.listen(PORT,()=>{
    connectDB();
    console.log("Server is up and Running on PORT:", PORT);
});
