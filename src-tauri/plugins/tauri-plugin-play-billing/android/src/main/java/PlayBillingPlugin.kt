package com.github.wintersteve25.myelin.playbilling

import android.app.Activity
import android.util.Log
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams

@InvokeArg
class ProductArgs {
  lateinit var productId: String
}

@TauriPlugin
class PlayBillingPlugin(private val activity: Activity) : Plugin(activity) {
  private var purchaseInvoke: Invoke? = null
  private var purchaseProductId: String? = null

  private val client = BillingClient.newBuilder(activity)
    .setListener { result, purchases -> onPurchasesUpdated(result, purchases) }
    .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
    .enableAutoServiceReconnection()
    .build()

  init {
    // Auto reconnection handles later drops; calls made before setup finishes wait for it.
    client.startConnection(object : BillingClientStateListener {
      override fun onBillingSetupFinished(result: BillingResult) {}
      override fun onBillingServiceDisconnected() {}
    })
  }

  @Command
  fun purchasePro(invoke: Invoke) {
    val args = invoke.parseArgs(ProductArgs::class.java)
    if (purchaseInvoke != null) {
      invoke.reject("Another purchase is already in progress.")
      return
    }
    val params = QueryProductDetailsParams.newBuilder()
      .setProductList(
        listOf(
          QueryProductDetailsParams.Product.newBuilder()
            .setProductId(args.productId)
            .setProductType(ProductType.INAPP)
            .build()
        )
      )
      .build()
    client.queryProductDetailsAsync(params) { result, details ->
      val product = details.productDetailsList.firstOrNull()
      val offerToken = product?.oneTimePurchaseOfferDetailsList?.firstOrNull()?.offerToken
      if (result.responseCode != BillingResponseCode.OK || product == null || offerToken == null) {
        invoke.reject("Pro is not available in Google Play right now.")
        return@queryProductDetailsAsync
      }
      val flow = BillingFlowParams.newBuilder()
        .setProductDetailsParamsList(
          listOf(
            BillingFlowParams.ProductDetailsParams.newBuilder()
              .setProductDetails(product)
              .setOfferToken(offerToken)
              .build()
          )
        )
        .build()
      activity.runOnUiThread {
        purchaseInvoke = invoke
        purchaseProductId = args.productId
        val launch = client.launchBillingFlow(activity, flow)
        if (launch.responseCode != BillingResponseCode.OK) {
          onPurchasesUpdated(launch, null)
        }
      }
    }
  }

  // Also called for purchases that finish outside `purchasePro`, e.g. an approved pending one.
  private fun onPurchasesUpdated(result: BillingResult, purchases: List<Purchase>?) {
    purchases?.forEach(::acknowledge)
    val invoke = purchaseInvoke ?: return
    val productId = purchaseProductId ?: return
    purchaseInvoke = null
    purchaseProductId = null
    when (result.responseCode) {
      BillingResponseCode.OK -> invoke.resolve(entitlement(owned(purchases, productId)))
      BillingResponseCode.ITEM_ALREADY_OWNED -> resolveEntitlement(invoke, productId)
      // Cancelled and pending purchases resolve inactive, matching the App Store plugin.
      BillingResponseCode.USER_CANCELED -> invoke.resolve(entitlement(null))
      else -> invoke.reject("The purchase failed: ${result.debugMessage}")
    }
  }

  @Command
  fun proEntitlement(invoke: Invoke) {
    resolveEntitlement(invoke, invoke.parseArgs(ProductArgs::class.java).productId)
  }

  private fun resolveEntitlement(invoke: Invoke, productId: String) {
    val params = QueryPurchasesParams.newBuilder().setProductType(ProductType.INAPP).build()
    client.queryPurchasesAsync(params) { result, purchases ->
      if (result.responseCode != BillingResponseCode.OK) {
        invoke.reject("Could not reach Google Play: ${result.debugMessage}")
        return@queryPurchasesAsync
      }
      val purchase = owned(purchases, productId)
      purchase?.let(::acknowledge)
      invoke.resolve(entitlement(purchase))
    }
  }

  private fun owned(purchases: List<Purchase>?, productId: String): Purchase? =
    purchases?.firstOrNull {
      it.products.contains(productId) && it.purchaseState == Purchase.PurchaseState.PURCHASED
    }

  // Play refunds purchases left unacknowledged for 3 days; entitlement checks retry failures.
  private fun acknowledge(purchase: Purchase) {
    if (purchase.purchaseState != Purchase.PurchaseState.PURCHASED || purchase.isAcknowledged) {
      return
    }
    val params = AcknowledgePurchaseParams.newBuilder()
      .setPurchaseToken(purchase.purchaseToken)
      .build()
    client.acknowledgePurchase(params) { result ->
      if (result.responseCode != BillingResponseCode.OK) {
        Log.w("PlayBilling", "Acknowledge failed: ${result.debugMessage}")
      }
    }
  }

  private fun entitlement(purchase: Purchase?): JSObject {
    val ret = JSObject()
    ret.put("active", purchase != null)
    // The purchase token is what the Play Developer API looks purchases up by.
    purchase?.let { ret.put("transactionId", it.purchaseToken) }
    return ret
  }
}
