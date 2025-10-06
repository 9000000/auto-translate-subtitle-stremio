<template>
  <div class="py-12 bg-gray-100 min-h-screen">
    <div class="max-w-4xl mx-auto sm:px-6 lg:px-8">
      <div class="bg-white overflow-hidden shadow-xl sm:rounded-lg">
        <div class="p-8 border-b border-gray-200">
          <h1 class="text-3xl font-bold text-gray-900 mb-2">
            Addon Configuration
          </h1>
          <p class="text-gray-600">
            Configure your subtitle translation settings below.
          </p>
        </div>
        <div class="p-8">
          <form @submit.prevent="saveConfig" class="space-y-8">
            <!-- Provider -->
            <div>
              <label for="provider" class="block text-sm font-medium text-gray-700">Provider</label>
              <select
                id="provider"
                v-model="form.provider"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option>Google Translate</option>
                <option>Google API</option>
                <option>Gemini API</option>
                <option>ChatGPT API</option>
                <option>DeepSeek API</option>
              </select>
              <p class="mt-2 text-sm text-gray-500">Select your preferred translation service.</p>
            </div>

            <!-- API Key (Conditional) -->
            <div v-if="['Gemini API', 'ChatGPT API', 'DeepSeek API'].includes(form.provider)">
              <label for="apikey" class="block text-sm font-medium text-gray-700">API Key</label>
              <input
                type="text"
                id="apikey"
                v-model="form.apikey"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <p class="mt-2 text-sm text-gray-500">Your API key for the selected provider.</p>
            </div>

            <!-- API Base URL -->
            <div>
              <label for="base_url" class="block text-sm font-medium text-gray-700">API Base URL</label>
              <input
                type="text"
                id="base_url"
                v-model="form.base_url"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                placeholder="e.g., https://api.openai.com/v1"
              />
              <p class="mt-2 text-sm text-gray-500">Optional: For self-hosted or compatible API endpoints.</p>
            </div>

            <!-- Model Name -->
            <div>
              <label for="model_name" class="block text-sm font-medium text-gray-700">Model Name</label>
              <select
                id="model_name"
                v-model="form.model_name"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option>gpt-4o-mini</option>
                <option>gpt-4o</option>
                <option>gpt-4-turbo</option>
                <option>gpt-3.5-turbo</option>
                <option>gemini-2.5-flash</option>
                <option>gemini-2.5-pro</option>
                <option>gemini-2.0-flash-lite</option>
                <option>deepseek-chat</option>
                <option>deepseek-reasoner</option>
              </select>
              <p class="mt-2 text-sm text-gray-500">Select the language model for translation.</p>
            </div>

            <!-- Batch Size -->
            <div>
              <label for="batch_size" class="block text-sm font-medium text-gray-700">Batch Size</label>
              <input
                type="number"
                id="batch_size"
                v-model="form.batch_size"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              />
              <p class="mt-2 text-sm text-gray-500">Number of lines to translate at once. Default is 60.</p>
            </div>

            <!-- Translate to -->
            <div>
              <label for="translateto" class="block text-sm font-medium text-gray-700">Translate to</label>
              <select
                id="translateto"
                v-model="form.translateto"
                class="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
              >
                <option v-for="lang in languages" :key="lang" :value="lang">{{ lang }}</option>
              </select>
              <p class="mt-2 text-sm text-gray-500">The target language for subtitles.</p>
            </div>

            <div class="flex justify-end pt-4">
              <button type="submit" class="inline-flex items-center px-6 py-3 border border-transparent text-base font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500">
                Save Configuration
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

const languages = ref([]);
const form = ref({
  provider: 'Google Translate',
  apikey: '',
  base_url: '',
  model_name: 'gpt-4o-mini',
  batch_size: 60,
  translateto: 'English',
});

const saveConfig = async () => {
  try {
    await axios.post('/save-config', form.value);
    alert('Configuration saved successfully!');
  } catch (error) {
    console.error('Error saving configuration:', error);
    alert('Failed to save configuration.');
  }
};

const fetchLanguages = async () => {
  try {
    const response = await axios.get('/get-languages');
    languages.value = response.data;
  } catch (error) {
    console.error('Error fetching languages:', error);
  }
};

onMounted(async () => {
  fetchLanguages();
  try {
    const response = await axios.get('/get-config');
    if (response.data) {
      form.value = { ...form.value, ...response.data };
    }
  } catch (error) {
    console.error('Error fetching configuration:', error);
  }
});
</script>