import AppSecrets from "./pkg/secret";
import Ports from "./internals/ports";
import Adapters from "./internals/adapters";
import Services from "./internals/services";
import {GoogleGenAI} from "@google/genai";
import wav from 'wav';

class AbsoluteBackend {
  adapters: Adapters;
  services: Services;
  port: Ports;

  constructor() {
    const appSecrets = new AppSecrets();
    const geminiClient : GoogleGenAI= new GoogleGenAI({apiKey: appSecrets.geminiConfiguration.apiKey})

    this.adapters = new Adapters({
      appSecrets,
      geminiClient
    });
    // this.adapters.ai.generateText("hi").then((a)=>{
    //   console.log({a})
    // })
     // this.adapters.ai.generateAudio("You are a Dark Comic Narrator, Read aloud: " +
     //    'The horizon ignited with artificial light, a sprawling constellation of steel and glass stretching as far as the eye could see. It was a skyline of jagged ambition, piercing the night with a million electric eyes. [gravelly, internal monologue, stoic] "Hello again, Gotham."')
     //     .then(({response,dollars}) => {
     //       console.log({dollars})
     //       const audioBuffer = Buffer.from(response, 'base64');
     //
     //       const fileName = 'results/test.wav';
     //       SaveWaveFile(fileName, audioBuffer);
     //     })


    this.services = new Services(this.adapters);
    this.port = new Ports(appSecrets, this.services, this.adapters);
  }

  run() {
    this.port.httpPort.listen();
  }

}

const absoluteBackend = new AbsoluteBackend();
absoluteBackend.run();    
