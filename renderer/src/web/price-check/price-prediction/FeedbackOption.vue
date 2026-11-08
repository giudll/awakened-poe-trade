<template>
  <ui-popover tag-name="div" trigger="click" placement="bottom" boundary="#price-window">
    <template #target>
      <button class="bg-gray-700 px-2 py-1 text-gray-400 leading-none opacity-50" :class="{ 'rounded-l': option === 'low', 'rounded-r': option === 'high' }"
        >{{ t(`extra.prediction_${option}`, option) }}</button>
    </template>
    <template #content>
      <form @submit.prevent="submit" class="w-64 p-2">
        <div>{{ text }}</div>
        <textarea v-if="option !== 'fair'"
          v-model="feedbackText"
          :placeholder="t('extra.feedback_reason', 'Why do you think so? (Not required)')"
          rows="5" class="w-full bg-gray-700 text-gray-100 p-1"></textarea>
        <button class="btn" type="submit">{{ t('extra.feedback_send', 'Send feedback') }}</button>
        <span class="ml-2">to poeprices.info</span>
      </form>
    </template>
  </ui-popover>
</template>

<script lang="ts">
import { computed, defineComponent, PropType, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import UiPopover from '@/web/ui/Popover.vue'
import { ParsedItem } from '@/parser'
import { sendFeedback } from './poeprices'

export default defineComponent({
  emits: ['sent'],
  components: { UiPopover },
  props: {
    option: {
      type: String as PropType<'fair' | 'low' | 'high'>,
      required: true
    },
    prediction: {
      type: Object as PropType<{ min: number, max: number, currency: 'chaos' | 'div' }>,
      required: true
    },
    item: {
      type: Object as PropType<ParsedItem>,
      required: true
    }
  },
  setup (props, ctx) {
    const { t } = useI18n()
    const feedbackText = ref('')

    const text = computed(() => {
      if (props.option === 'low') {
        return t('extra.prediction_too_low', 'Predicted price is too low.')
      } else if (props.option === 'high') {
        return t('extra.prediction_too_high', 'Predicted price is too high.')
      } else {
        return t('extra.prediction_is_fair', 'Predicted price is fair.')
      }
    })

    function submit () {
      ctx.emit('sent')
      sendFeedback({
        text: feedbackText.value,
        option: props.option
      }, {
        min: props.prediction.min,
        max: props.prediction.max,
        currency: (props.prediction.currency === 'div') ? 'divine' : 'chaos'
      }, props.item)
    }

    return {
      t,
      feedbackText,
      text,
      submit
    }
  }
})
</script>
