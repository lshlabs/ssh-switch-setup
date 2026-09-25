package de.blinkt.openvpn.api

import android.os.Parcel
import android.os.Parcelable

/**
 * Wire-compatible copy of OpenVPN for Android's external AIDL profile model.
 * The external API is documented as exempt from the OpenVPN for Android GPLv2.
 */
class APIVpnProfile private constructor(parcel: Parcel) : Parcelable {
    val mUUID: String = parcel.readString().orEmpty()
    val mName: String = parcel.readString().orEmpty()
    val mUserEditable: Boolean = parcel.readInt() != 0

    override fun describeContents(): Int = 0

    override fun writeToParcel(destination: Parcel, flags: Int) {
        destination.writeString(mUUID)
        destination.writeString(mName)
        destination.writeInt(if (mUserEditable) 0 else 1)
    }

    companion object CREATOR : Parcelable.Creator<APIVpnProfile> {
        override fun createFromParcel(parcel: Parcel): APIVpnProfile = APIVpnProfile(parcel)

        override fun newArray(size: Int): Array<APIVpnProfile?> = arrayOfNulls(size)
    }
}
